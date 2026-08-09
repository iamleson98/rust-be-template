use std::sync::Arc;

use axum_extra::extract::cookie::CookieJar;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;

use crate::config::CookieConfig;

use super::cookies::{ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, thiserror::Error)]
pub enum CsrfError {
    #[error("missing csrf cookie")]
    MissingCookie,
    #[error("missing csrf header")]
    MissingHeader,
    #[error("csrf token mismatch")]
    Mismatch,
    #[error("csrf token expired")]
    Expired,
    #[error("csrf token malformed")]
    Malformed,
}

/// Double-submit CSRF protection. A signed token is set in a non-HttpOnly
/// cookie (so JS can read it) AND expected to be present in a request
/// header on mutating requests. Both must match (and be HMAC-valid).
pub struct CsrfManager {
    key: [u8; 32],
}

impl CsrfManager {
    pub fn new(secret: &str) -> Self {
        // Derive a 32-byte key from the configured secret via SHA-256.
        let mut hasher = Sha256::new();
        hasher.update(secret.as_bytes());
        let key = hasher.finalize().into();
        Self { key }
    }

    /// Issue a fresh CSRF token valid for `ttl`. Format:
    /// `base64(exp_timestamp).base64(hmac(exp_timestamp))`.
    pub fn issue(&self, ttl: chrono::Duration) -> String {
        let exp = OffsetDateTime::now_utc() + time::Duration::seconds(ttl.num_seconds());
        let exp_unix = exp.unix_timestamp();
        let payload = exp_unix.to_string();
        let mac = self.sign(exp_unix.to_string().as_bytes());
        format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(mac)
        )
    }

    /// Verify a token's signature + expiry. Returns `Ok(())` on success.
    pub fn verify(&self, token: &str, now: OffsetDateTime) -> Result<(), CsrfError> {
        let (b64_payload, b64_mac) = token.split_once('.').ok_or(CsrfError::Malformed)?;
        let payload = URL_SAFE_NO_PAD
            .decode(b64_payload)
            .map_err(|_| CsrfError::Malformed)?;
        let mac = URL_SAFE_NO_PAD
            .decode(b64_mac)
            .map_err(|_| CsrfError::Malformed)?;
        let payload_str = String::from_utf8(payload).map_err(|_| CsrfError::Malformed)?;
        let exp_unix: i64 = payload_str.parse().map_err(|_| CsrfError::Malformed)?;

        let expected = self.sign(payload_str.as_bytes());
        if !constant_time_eq::constant_time_eq(&mac, &expected) {
            return Err(CsrfError::Mismatch);
        }
        if exp_unix < now.unix_timestamp() {
            return Err(CsrfError::Expired);
        }
        Ok(())
    }

    /// Check the double-submit pattern against a request. Reads the
    /// `csrf_token` cookie + `X-CSRF-Token` header; both must be present
    /// and equal (and signature-valid).
    pub fn check_request(&self, jar: &CookieJar, header: Option<&str>) -> Result<(), CsrfError> {
        let cookie = jar
            .get(CSRF_COOKIE)
            .ok_or(CsrfError::MissingCookie)?
            .value();
        let header = header.ok_or(CsrfError::MissingHeader)?;
        if cookie != header {
            return Err(CsrfError::Mismatch);
        }
        self.verify(cookie, OffsetDateTime::now_utc())?;
        Ok(())
    }

    fn sign(&self, payload: &[u8]) -> Vec<u8> {
        let mut mac = HmacSha256::new_from_slice(&self.key).expect("hmac key length");
        mac.update(payload);
        mac.finalize().into_bytes().to_vec()
    }
}

/// Helper: extract access + refresh tokens from cookies.
pub fn extract_tokens(jar: &CookieJar) -> (Option<String>, Option<String>) {
    let access = jar.get(ACCESS_COOKIE).map(|c| c.value().to_string());
    let refresh = jar.get(REFRESH_COOKIE).map(|c| c.value().to_string());
    (access, refresh)
}

/// Marker so other modules can grab a cheap shared instance.
pub type SharedCsrfManager = Arc<CsrfManager>;

#[allow(dead_code)]
fn _config_marker(_: &CookieConfig) {}
