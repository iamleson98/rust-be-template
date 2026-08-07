use chrono::{Duration, NaiveDateTime, Utc};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use uuid::Uuid;

use crate::config::JwtConfig;
use crate::entity::refresh_token;

type HmacSha256 = Hmac<Sha256>;

/// A refresh token's wire form: `id.secret`. We store only the SHA-256 of
/// the secret in the database — the raw token only ever lives in the
/// HttpOnly cookie.
#[derive(Debug, Clone)]
pub struct RefreshTokenValue {
    pub id: Uuid,
    pub secret: String,
}

impl RefreshTokenValue {
    /// Generate a new opaque refresh token (UUID + 32 random bytes hex).
    pub fn generate() -> Self {
        let id = Uuid::new_v4();
        let mut buf = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut buf);
        let secret = hex::encode(buf);
        Self { id, secret }
    }

    /// Wire form to put in the cookie: `id.secret`.
    pub fn to_cookie_value(&self) -> String {
        format!("{}.{}", self.id, self.secret)
    }

    /// Parse a cookie value back into (id, secret). Returns None on bad shape.
    pub fn parse(cookie_value: &str) -> Option<Self> {
        let (id_str, secret) = cookie_value.split_once('.')?;
        let id = Uuid::parse_str(id_str).ok()?;
        Some(Self {
            id,
            secret: secret.to_string(),
        })
    }

    /// SHA-256 hex of the secret. This is what we store in the DB.
    pub fn secret_hash(&self) -> String {
        let mut mac = HmacSha256::new_from_slice(b"refresh-token-hmac-key")
            .expect("hmac key length is valid");
        mac.update(self.secret.as_bytes());
        let bytes = mac.finalize().into_bytes();
        hex::encode(bytes)
    }
}

pub struct RefreshTokenManager {
    cfg: JwtConfig,
}

impl RefreshTokenManager {
    pub fn new(cfg: JwtConfig) -> Self {
        Self { cfg }
    }

    pub fn build_model(
        &self,
        token: &RefreshTokenValue,
        user_id: Uuid,
        user_agent: Option<String>,
        ip: Option<String>,
    ) -> refresh_token::Model {
        let now = Utc::now().naive_utc();
        let exp = now + Duration::seconds(self.cfg.refresh_ttl_secs as i64);
        refresh_token::Model {
            id: token.id,
            user_id,
            token_hash: token.secret_hash(),
            issued_at: now,
            expires_at: exp,
            revoked: false,
            user_agent,
            ip,
        }
    }

    pub fn expires_at(&self) -> NaiveDateTime {
        Utc::now().naive_utc() + Duration::seconds(self.cfg.refresh_ttl_secs as i64)
    }
}
