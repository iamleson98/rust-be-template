//! APNs VoIP push client — the iOS half of "ring even when the app is
//! closed".
//!
//! Apple requires a dedicated transport for call wake-ups:
//! * FCM **cannot** send `apns-push-type: voip` pushes (Firebase only
//!   proxies regular APNs), so the backend talks to APNs directly for
//!   iOS devices.
//! * Every VoIP push must be reported to CallKit by the app (iOS 13+)
//!   — the mobile app wires PushKit → `flutter_callkit_incoming`, which
//!   shows the native CallKit incoming-call screen using the payload
//!   this module builds (caller name / avatar / ring duration).
//!
//! Auth is Apple's **token-based** flow: an ES256 JWT signed with the
//! `.p8` provider key (`APNS_KEY_PEM` or `APNS_KEY_PATH`), `kid` =
//! key id, `iss` = team id, cached well under Apple's 1-hour bound.
//! Transport is plain `POST https://api.push.apple.com/3/device/{token}`
//! over HTTP/2 (APNs rejects HTTP/1.1).
//!
//! All failures are soft, same contract as [`crate::push::fcm`]: push
//! is a best-effort accelerator, the WS ring is the source of truth,
//! `410 Unregistered` maps to `Gone` so the caller prunes the token
//! row.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{Algorithm, EncodingKey, Header};
use parking_lot::RwLock;

/// Outcome of a single APNs send — mirrors [`super::fcm::FcmSendOutcome`]
/// so the fan-out treats both transports identically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApnsSendOutcome {
    /// Accepted by APNs (200).
    Sent,
    /// 410 — token no longer registered for this app. Caller should
    /// delete the row.
    Gone,
    /// Transient failure (network / 5xx / throttling). Keep the row.
    Transient,
}

/// Provider credentials for the token-based (`.p8`) APNs auth flow.
#[derive(Debug, Clone, Default)]
pub struct ApnsProviderKey {
    /// The `.p8` private key PEM (PKCS#8). Inline env var
    /// (`APNS_KEY_PEM`) takes precedence over [`Self::key_path`].
    pub key_pem: String,
    /// Filesystem path to the `.p8` key (`APNS_KEY_PATH`).
    pub key_path: String,
    /// The 10-char key id from the Apple developer console (`APNS_KEY_ID`).
    pub key_id: String,
    /// The 10-char team id (`APNS_TEAM_ID`).
    pub team_id: String,
}

impl ApnsProviderKey {
    pub fn is_empty(&self) -> bool {
        (self.key_pem.is_empty() && self.key_path.is_empty())
            || self.key_id.is_empty()
            || self.team_id.is_empty()
    }

    /// Resolve the key PEM: inline value, else read the path. Reading
    /// happens once at boot — a missing/unparsable key disables push
    /// loudly instead of failing per-call.
    fn resolve_pem(&self) -> Result<String, String> {
        if !self.key_pem.trim().is_empty() {
            return Ok(self.key_pem.trim().to_string());
        }
        let raw = std::fs::read_to_string(&self.key_path)
            .map_err(|e| format!("APNS_KEY_PATH {}: {e}", self.key_path))?;
        if raw.trim().is_empty() {
            return Err(format!("APNS_KEY_PATH {}: file is empty", self.key_path));
        }
        Ok(raw.trim().to_string())
    }
}

/// A minimal APNs VoIP sender with a cached provider JWT.
pub struct ApnsClient {
    key: EncodingKey,
    key_id: String,
    team_id: String,
    /// The push topic — the app's bundle id (`APNS_TOPIC`).
    topic: String,
    http: reqwest::Client,
    /// APNs base URL (production / sandbox).
    base: String,
    /// Cached `(jwt, created_at)`.
    token_cache: RwLock<Option<(String, Instant)>>,
}

/// Provider tokens may live up to 1h (Apple); refresh comfortably
/// earlier so an in-flight fan-out never signs with a stale token.
const TOKEN_TTL: Duration = Duration::from_secs(50 * 60);

impl ApnsClient {
    /// Build from provider credentials. `Err` only on malformed input
    /// (missing key / unparsable PEM) — the caller treats that as "APNs
    /// disabled" and logs it loudly.
    pub fn from_parts(key: &ApnsProviderKey, topic: &str, sandbox: bool) -> Result<Self, String> {
        if topic.trim().is_empty() {
            return Err("APNS_TOPIC (app bundle id) is required for APNs push".into());
        }
        let pem = key.resolve_pem()?;
        let encoding = EncodingKey::from_ec_pem(pem.as_bytes())
            .map_err(|e| format!("APNS key: not a valid P-256 .p8 PEM: {e}"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;
        Ok(Self {
            key: encoding,
            key_id: key.key_id.clone(),
            team_id: key.team_id.clone(),
            topic: topic.trim().to_string(),
            http,
            base: if sandbox {
                "https://api.sandbox.push.apple.com".into()
            } else {
                "https://api.push.apple.com".into()
            },
            token_cache: RwLock::new(None),
        })
    }

    /// The APNs provider JWT (ES256, `kid` = key id, `iss` = team id).
    /// Apple has no refresh dance — the same JWT is reused until close
    /// to its 1h validity, then re-signed.
    async fn provider_token(&self) -> Result<String, String> {
        if let Some((tok, at)) = self.token_cache.read().as_ref() {
            if at.elapsed() < TOKEN_TTL {
                return Ok(tok.clone());
            }
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.key_id.clone());
        let claims = serde_json::json!({ "iss": self.team_id, "iat": now });
        let jwt = jsonwebtoken::encode(&header, &claims, &self.key)
            .map_err(|e| format!("apns provider jwt: {e}"))?;
        *self.token_cache.write() = Some((jwt.clone(), Instant::now()));
        Ok(jwt)
    }

    /// Send a **VoIP** push (free-form JSON payload — PushKit hands the
    /// full body to the app, which reports it to CallKit). `expiration`
    /// bounds delivery: a ring nobody answered must not wake the phone
    /// minutes later.
    pub async fn send_voip(
        &self,
        device_token: &str,
        payload: &serde_json::Value,
        collapse_id: &str,
        expiration: Duration,
    ) -> ApnsSendOutcome {
        let token = match self.provider_token().await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("apns provider token failed: {e}");
                return ApnsSendOutcome::Transient;
            }
        };
        let expires_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + expiration.as_secs();
        let url = format!("{}/3/device/{}", self.base, device_token);
        let resp = match self
            .http
            .post(&url)
            .bearer_auth(&token)
            .header("apns-push-type", "voip")
            .header("apns-topic", &self.topic)
            // VoIP pushes are time-critical — deliver immediately.
            .header("apns-priority", "10")
            .header("apns-collapse-id", collapse_id)
            .header("apns-expiration", expires_at.to_string())
            .json(payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("apns send (network): {e}");
                return ApnsSendOutcome::Transient;
            }
        };
        match resp.status().as_u16() {
            200 => ApnsSendOutcome::Sent,
            410 => ApnsSendOutcome::Gone,
            status => {
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!("apns send {status}: {body}");
                ApnsSendOutcome::Transient
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Throwaway P-256 PKCS#8 key generated purely for this test
    /// (`openssl ecparam -name prime256v1 -genkey | openssl pkcs8 -topk8
    /// -nocrypt`) — guards the Apple .p8 key format production uses.
    const TEST_EC_KEY: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg9tjNPSymLl7x3fyW
UueJrD8T5wvWH8pLbaZ4qEXiMm6hRANCAAR0TqA/zvgxh1hXVLzQ8iN+oVK/lmdW
qa9NoNsBdPax9GabtFBWPgOtMyEAZIc/NUBtBWYsYlEl9mkB/0wi5rOV
-----END PRIVATE KEY-----";

    fn test_key() -> ApnsProviderKey {
        ApnsProviderKey {
            key_pem: TEST_EC_KEY.into(),
            key_path: String::new(),
            key_id: "ABC123DEFG".into(),
            team_id: "TEAM12345".into(),
        }
    }

    #[test]
    fn provider_key_is_empty_until_every_credential_is_present() {
        assert!(ApnsProviderKey::default().is_empty());
        assert!(test_key().key_path.is_empty() && !test_key().is_empty());
        // Key present but no ids → still "not configured".
        let mut k = test_key();
        k.team_id.clear();
        assert!(k.is_empty());
    }

    #[test]
    fn client_rejects_bad_credentials_loudly() {
        // Missing topic.
        assert!(ApnsClient::from_parts(&test_key(), "  ", false).is_err());
        // Not a P-256 key.
        let mut bad = test_key();
        bad.key_pem = "not a pem".into();
        assert!(ApnsClient::from_parts(&bad, "com.example.app", false).is_err());
        // Real EC key, correct topic → accepted.
        assert!(ApnsClient::from_parts(&test_key(), "com.example.app", false).is_ok());
        assert!(ApnsClient::from_parts(&test_key(), "com.example.app", true).is_ok());
    }

    #[tokio::test]
    async fn send_voip_sets_apple_required_headers_and_body() {
        // A tiny one-shot HTTP server: capture the raw request, answer
        // 200. reqwest speaks HTTP/1.1 to it (no ALPN over plain TCP) —
        // the same request-building code path APNs exercises over h2.
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().unwrap();
        let serve = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("accept");
            let mut buf = vec![0u8; 8192];
            let mut raw = Vec::new();
            loop {
                let n = sock.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
                let head_end = find_head_end(&raw);
                if let Some(he) = head_end {
                    let body_len = content_length(&raw[..he]);
                    if raw.len() >= he + body_len {
                        break;
                    }
                }
            }
            let _ = sock.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n");
            let _ = sock.flush();
            raw
        });

        let client = ApnsClient::from_parts(&test_key(), "com.example.app", false).unwrap();
        // Point the client at the local server (the base is private —
        // re-derive via the public API? For the test we rebuild one
        // through from_parts + a base override is not exposed; instead
        // bind a SHORT-LIVED client with the production base replaced.
        // Simplest: reach in through a test-only constructor.
        let client = ApnsClient {
            base: format!("http://{addr}"),
            ..client
        };

        let payload = serde_json::json!({
            "id": "call-c1",
            "nameCaller": "Nguyễn Văn A",
            "handle": "c1",
            "type": 0,
            "duration": 60_000,
        });
        let out = client
            .send_voip("aabbcc", &payload, "call-c1", Duration::from_secs(90))
            .await;
        assert_eq!(out, ApnsSendOutcome::Sent);

        let raw = serve.join().expect("served");
        let text = String::from_utf8_lossy(&raw).to_string();
        // ── Request line + Apple-mandated headers ────────────────────
        assert!(text.starts_with("POST /3/device/aabbcc "));
        assert!(text.contains("apns-push-type: voip"));
        assert!(text.contains("apns-topic: com.example.app"));
        assert!(text.contains("apns-priority: 10"));
        assert!(text.contains("apns-collapse-id: call-c1"));
        assert!(text.contains("apns-expiration: "));
        // HTTP headers are case-insensitive — reqwest sends `Bearer` —
        // so locate the header on a lowercased copy, then slice the
        // JWT out of the ORIGINAL text (base64 is case-sensitive).
        let lower = text.to_ascii_lowercase();
        let header = "authorization: bearer ";
        let idx = lower.find(header).expect("bearer token present") + header.len();
        let auth = text[idx..].split("\r\n").next().expect("bearer value");
        // Bearer is a 3-part ES256 JWT with the key id + team id.
        let parts: Vec<&str> = auth.split('.').collect();
        assert_eq!(parts.len(), 3);
        let header_json = decode_jwt_segment(parts[0]);
        assert!(header_json.contains("ES256"));
        assert!(header_json.contains("ABC123DEFG"));
        let claims_json = decode_jwt_segment(parts[1]);
        assert!(claims_json.contains("TEAM12345"));
        // ── Body: the free-form VoIP payload rides the root JSON ──────
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("");
        assert!(body.contains("\"nameCaller\":\"Nguyễn Văn A\""));
        assert!(body.contains("\"duration\":60000"));
    }

    #[tokio::test]
    async fn send_voip_classifies_410_as_gone() {
        use tokio::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().unwrap();

        let serve = tokio::task::spawn(async move {
            let (mut sock, _) = listener.accept().await.expect("accept");
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = vec![0u8; 8192];
            let mut raw = Vec::new();
            loop {
                let n = sock.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
                if let Some(he) = find_head_end(&raw) {
                    if raw.len() >= he + content_length(&raw[..he]) {
                        break;
                    }
                }
            }
            let _ = sock
                .write_all(b"HTTP/1.1 410 Gone\r\ncontent-length: 0\r\n\r\n")
                .await;
            raw
        });

        let built = ApnsClient::from_parts(&test_key(), "com.example.app", false).unwrap();
        let client = ApnsClient {
            base: format!("http://{addr}"),
            ..built
        };
        let out = client
            .send_voip(
                "dead",
                &serde_json::json!({}),
                "call-x",
                Duration::from_secs(30),
            )
            .await;
        assert_eq!(out, ApnsSendOutcome::Gone);
        let _ = serve.await;
    }

    fn find_head_end(raw: &[u8]) -> Option<usize> {
        raw.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
    }

    fn content_length(head: &[u8]) -> usize {
        let text = String::from_utf8_lossy(head).to_ascii_lowercase();
        text.split("content-length:")
            .nth(1)
            .and_then(|rest| rest.split("\r\n").next())
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0)
    }

    fn decode_jwt_segment(seg: &str) -> String {
        use base64::Engine as _;
        let normalized = seg
            .trim_end_matches('=')
            .replace('-', "+")
            .replace('_', "/");
        // Pad to a multiple of 4.
        let mut s = normalized;
        while !s.len().is_multiple_of(4) {
            s.push('=');
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s.as_bytes())
            .unwrap_or_default();
        String::from_utf8_lossy(&bytes).to_string()
    }
}
