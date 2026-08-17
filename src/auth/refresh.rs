use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::Sha256;
use uuid::Uuid;

use crate::config::JwtConfig;
use crate::entity::refresh_tokens;

type HmacSha256 = Hmac<Sha256>;

/// A refresh token's wire form: `id.secret`. We store only the HMAC-SHA-256
/// of the secret in the database — the raw token only ever lives in the
/// HttpOnly cookie.
#[derive(Debug, Clone)]
pub struct RefreshTokenValue {
    pub id: Uuid,
    pub secret: String,
}

impl RefreshTokenValue {
    /// Generate a new opaque refresh token (UUID + 32 random bytes hex).
    ///
    /// Uses `OsRng` (not `ThreadRng`) for cryptographic material — it's
    /// the explicit, self-documenting choice and survives any future
    /// `rand` upgrade that might change `thread_rng()`'s backing RNG.
    pub fn generate() -> Self {
        let id = Uuid::new_v4();
        let mut buf = [0u8; 32];
        OsRng.fill_bytes(&mut buf);
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

    /// HMAC-SHA-256 of the secret keyed by the deployment's JWT secret.
    ///
    /// This is what we store in the DB. Keying the HMAC with the JWT
    /// secret (rather than a hard-coded literal) means a DB leak alone
    /// is not enough to forge tokens — the attacker also needs the
    /// JWT secret, which is held in process memory + env vars only.
    pub fn secret_hash(&self, jwt_secret: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(jwt_secret.as_bytes())
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
    ) -> refresh_tokens::Model {
        let now = Utc::now();
        let exp = now + Duration::seconds(self.cfg.refresh_ttl_secs as i64);
        refresh_tokens::Model {
            id: token.id,
            user_id,
            token_hash: token.secret_hash(&self.cfg.secret),
            issued_at: now,
            expires_at: exp,
            revoked: false,
            user_agent,
            ip,
        }
    }

    pub fn expires_at(&self) -> DateTime<Utc> {
        Utc::now() + Duration::seconds(self.cfg.refresh_ttl_secs as i64)
    }

    /// Convenience: hash a secret with the manager's configured JWT secret.
    pub fn secret_hash(&self, secret: &str) -> String {
        let value = RefreshTokenValue {
            id: Uuid::nil(),
            secret: secret.to_string(),
        };
        value.secret_hash(&self.cfg.secret)
    }
}
