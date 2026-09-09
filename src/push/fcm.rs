//! FCM HTTP v1 client — the transport half of "ring when closed".
//!
//! Auth: OAuth2 service-account flow exactly as Google specifies —
//! a self-signed RS256 JWT (scopes
//! `https://www.googleapis.com/auth/firebase.messaging`) exchanged for
//! an access token at the account's `token_uri`, cached until shortly
//! before expiry. The JWT is signed with the account's private key
//! (PKCS#8 PEM — `jsonwebtoken` 9 parses both PKCS#1 and PKCS#8).
//!
//! Sends: `POST https://fcm.googleapis.com/v1/projects/{id}/messages:send`
//! with a **data payload** (not notification payload) so the client
//! owns presentation — Android data messages with `priority: HIGH`
//! bypass Doze, and the app renders the full-screen call UI; iOS maps
//! them onto PushKit/CallKit when the app registers a voip token.
//!
//! All failures are soft: FCM is a best-effort accelerator, never a
//! prerequisite for call setup — the WS ring path is the source of
//! truth. `404/410 UNREGISTERED` maps to [`FcmSendOutcome::Gone`] so
//! the caller prunes the stale token row.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{Algorithm, EncodingKey, Header};
use parking_lot::RwLock;
use serde::Deserialize;

/// Parsed Firebase service-account credentials
/// (`FCM_CREDENTIALS_JSON` — the whole JSON file Google gives you).
#[derive(Debug, Clone, Deserialize)]
pub struct ServiceAccount {
    pub project_id: String,
    pub client_email: String,
    pub private_key: String,
    #[serde(default = "default_token_uri")]
    pub token_uri: String,
}

fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".to_string()
}

/// Outcome of a single send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FcmSendOutcome {
    /// Delivered (or at least accepted by FCM).
    Sent,
    /// 404 / 410 — the token no longer belongs to an installed app.
    /// Caller should delete the row.
    Gone,
    /// Transient failure (network / 5xx / 429). Retry later; do NOT
    /// prune the token.
    Transient,
}

/// A minimal FCM HTTP v1 sender with a cached OAuth2 access token.
pub struct FcmClient {
    account: ServiceAccount,
    key: EncodingKey,
    http: reqwest::Client,
    /// Cached `(token, expires_at)`.
    token_cache: RwLock<Option<(String, Instant)>>,
}

const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
/// Refresh the access token this long before its real expiry.
const TOKEN_SKEW: Duration = Duration::from_secs(60);

impl FcmClient {
    /// Build from a service-account JSON string. `Err` only on
    /// malformed input (bad JSON / unparsable key) — the caller treats
    /// that as "push disabled" and logs it loudly, since it means the
    /// operator's `FCM_CREDENTIALS_JSON` needs fixing.
    pub fn from_credentials(json: &str) -> Result<Self, String> {
        let account: ServiceAccount = serde_json::from_str(json)
            .map_err(|e| format!("FCM_CREDENTIALS_JSON: invalid JSON: {e}"))?;
        if account.project_id.is_empty()
            || account.client_email.is_empty()
            || account.private_key.is_empty()
        {
            return Err(
                "FCM_CREDENTIALS_JSON: missing project_id / client_email / private_key".to_string(),
            );
        }
        let key = EncodingKey::from_rsa_pem(account.private_key.as_bytes())
            .map_err(|e| format!("FCM_CREDENTIALS_JSON: unparsable private key: {e}"))?;
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?;
        Ok(Self {
            account,
            key,
            http,
            token_cache: RwLock::new(None),
        })
    }

    pub fn project_id(&self) -> &str {
        &self.account.project_id
    }

    /// Obtain a fresh-enough OAuth2 access token (cached).
    async fn access_token(&self) -> Result<String, String> {
        if let Some((tok, exp)) = self.token_cache.read().as_ref() {
            if *exp > Instant::now() + TOKEN_SKEW {
                return Ok(tok.clone());
            }
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let claims = serde_json::json!({
            "iss": self.account.client_email,
            "scope": FCM_SCOPE,
            "aud": self.account.token_uri,
            "iat": now,
            "exp": now + 3600,
        });
        let assertion = jsonwebtoken::encode(&Header::new(Algorithm::RS256), &claims, &self.key)
            .map_err(|e| format!("jwt encode: {e}"))?;

        let resp = self
            .http
            .post(&self.account.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .map_err(|e| format!("token endpoint: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("token endpoint {status}: {body}"));
        }
        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("token response parse: {e}"))?;
        let token = json
            .get("access_token")
            .and_then(|v| v.as_str())
            .ok_or("token response missing access_token")?
            .to_string();
        let expires_in = json
            .get("expires_in")
            .and_then(|v| v.as_u64())
            .unwrap_or(3600)
            .min(3600);
        let exp = Instant::now() + Duration::from_secs(expires_in);
        *self.token_cache.write() = Some((token.clone(), exp));
        Ok(token)
    }

    /// Send a **data** message (client-owned presentation) to one
    /// device token. Android: `priority: HIGH` + `collapseKey` per
    /// call-id so a re-routed ring replaces the stale one.
    pub async fn send_data(
        &self,
        device_token: &str,
        data: &serde_json::Value,
        collapse_key: &str,
    ) -> FcmSendOutcome {
        let token = match self.access_token().await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("fcm token fetch failed: {e}");
                return FcmSendOutcome::Transient;
            }
        };
        let body = serde_json::json!({
            "message": {
                "token": device_token,
                "android": {
                    "priority": "HIGH",
                    "collapseKey": collapse_key,
                    "data": data,
                },
                "apns": {
                    "headers": {
                        "apns-collapse-id": collapse_key,
                    },
                    "payload": {
                        "aps": { "content-available": 1, "sound": "default" },
                        "data": data,
                    }
                }
            }
        });
        let url = format!(
            "https://fcm.googleapis.com/v1/projects/{}/messages:send",
            self.account.project_id
        );
        let resp = match self
            .http
            .post(&url)
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("fcm send (network): {e}");
                return FcmSendOutcome::Transient;
            }
        };
        match resp.status().as_u16() {
            200 => FcmSendOutcome::Sent,
            404 | 410 => FcmSendOutcome::Gone,
            s => {
                let body = resp.text().await.unwrap_or_default();
                tracing::warn!("fcm send {s}: {body}");
                FcmSendOutcome::Transient
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_account_parses_full_json() {
        let json = r#"{
            "project_id": "proj-1",
            "client_email": "svc@proj-1.iam.gserviceaccount.com",
            "private_key": "not-a-key",
            "token_uri": "https://oauth2.googleapis.com/token"
        }"#;
        let sa: ServiceAccount = serde_json::from_str(json).unwrap();
        assert_eq!(sa.project_id, "proj-1");
        assert_eq!(sa.client_email, "svc@proj-1.iam.gserviceaccount.com");
        assert_eq!(sa.token_uri, "https://oauth2.googleapis.com/token");
    }

    #[test]
    fn service_account_defaults_token_uri() {
        let json = r#"{"project_id":"p","client_email":"c","private_key":"k"}"#;
        let sa: ServiceAccount = serde_json::from_str(json).unwrap();
        assert_eq!(sa.token_uri, "https://oauth2.googleapis.com/token");
    }

    #[test]
    fn client_rejects_bad_credentials_loudly() {
        assert!(FcmClient::from_credentials("not json").is_err());
        // Valid JSON but the "private key" is not a key.
        let json = r#"{"project_id":"p","client_email":"c","private_key":"k"}"#;
        assert!(FcmClient::from_credentials(json).is_err());
    }

    #[test]
    fn client_accepts_pkcs8_rsa_key() {
        // Throwaway 2048-bit PKCS#8 RSA key generated purely for this
        // test (openssl genrsa | openssl pkcs8 -topk8 -nocrypt). It
        // guards the Google-service-account key format (PKCS#8, not
        // PKCS#1) that production credentials use.
        let json = serde_json::json!({
            "project_id": "p",
            "client_email": "c@x.iam.gserviceaccount.com",
            "private_key": TEST_PKCS8_KEY,
        })
        .to_string();
        let client = FcmClient::from_credentials(&json);
        assert!(client.is_ok(), "PKCS8 service-account key must be accepted");
    }

    /// Throwaway 2048-bit PKCS#8 RSA key — generated with
    /// `openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt` for this
    /// test only; never used anywhere else.
    const TEST_PKCS8_KEY: &str = "-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDgXBxS/p+uJIET
sAaCXWJN6RPe8UKfZ2pvRlwibeYrJPcq0zsglUM3MFsc177DEc1p29j02LhFKGax
usFyV7t1FvufBVYJ58JN6S7PtJu4eWxG/eBdqsEecUYR+LhKGacKhwt9BWdefBE1
LBlsqfnKQdpdUenuhenwjozD6ht2IMT1zq7vHmUe1eYgx22zzekSQFEW5wATyQ4y
fBEwqIZy56ElPNLRwdOFHjpzm9PueDkSbPPZ+LARgG9e62zwlPqWy9XvNoiu3iQ3
By9AmNzYUFZXU8bV1/jmwcswhukZHUkEyEsQuwVvIww9FJtYsEllJYSYvAI6VJ0U
6XIEJFuvAgMBAAECggEARyROAu8kWQbQOxrs5XeRDV1j5KSh2IPlVwV7f5tTici9
60FxlUJfPufBbGLo5VgGx5NjtzflLmDCN4cdghFZqqYwAVuizZ9EmInhQxFk81jl
QZmNBIZ5mBqY+mfgn/aEZi0uMmV9QpOarT6fjTpUr5K0GDU6NV0XMiUxc4oPTSQ8
3t44XbfyJzdHBrKVeGzeyQb30AEQCtStl/Beoqqhh94q6/aRL5eZFx95anqk2GJ+
ciczf+dLGCh8bB9eqLR5N0JaLqOEpBnjF2/6b+au3LLu1hUQwGfyhArk+M69dDmF
bWm8Y0Ox+IDX75IjHESbdCm9bccuLGaN4eBMRj0CKQKBgQD3ixfWVURvyaAkdJ08
TWWBw4G13+jIw5g3GM/Ff+69D+rmxCD7moTXudZYfbebEeVEOPvkJGrTd9BKcdu6
mUduhJG8stx1NyU7ipjPwWv8zciADYjn28CpUKpKhLYK9JyWINlwn42U0SYfxMNL
P9JrxYJlbt8w1U5cJhlO4b/CAwKBgQDoBkOyskOCNdc0pUI5pCu66uPl0ZXDXl+S
tdDs1YG+z5UaihZ+D8Ve2qkCyoQII8xKeGwG9iHyoiTfFRm28ohFxTCInIeRA8UX
Bpe3irEormZV03uG12Rtrn2W7D9djtDGtlz8s3ofWLuwgjJPXYYMIWPn60MziFJR
1ENz+htF5QKBgAnAqyHAnj+hO/PzvDYh/nvMThHyTmOKgTa6fYUUcz1zoReSZpJD
FjTBl5ZI7bDoVZYIgLQOUz8dm1Ezhyqk21GZW3yJt3HOyGK+JSMaRbziBqI05k3s
NHz3Np5U+C8aUAkCJk7vmk5gpxXdVKxkSVABqg+A/L4ZyUqMHbcj4cAtAoGAJz3H
/VUA7ejFOPYqOS125+oKGThVJ/GyIFH3v9ZsVyUshoyMOU3Zh61boEk4A1hqmL29
J4BBRZP+wGwFKVfjjElJaBFxLCmDD93hkv018Tdtv15BKhELvzEftILIRL5+uNzm
5SZFpT+Qns2mTJ34qdyL1RGJEBIiOgy4S8klC7ECgYEA1jdJl12Uw8gJ/QdMPR+/
HUUUsHazAhlXzCcCM0LAozK+moTT1bISVSm53/yKZ5czB2ejvwWWJJ/P+D2i2zgG
sH7ZKZ85uzJM/RuqJPM/53juG6mdcEpk+XktOg0iKQ9ZYI+Y1YtAi0eKYwTkho7l
q2R3gV13qfpWmtPu0J3ZscQ=
-----END PRIVATE KEY-----
";
}
