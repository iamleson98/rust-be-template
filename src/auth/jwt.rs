use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::JwtConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessTokenClaims {
    pub sub: Uuid, // user id
    pub iss: String,
    pub iat: i64,
    pub exp: i64,
    pub typ: String, // "access"
    /// Unique token id. Without it two tokens minted in the same second
    /// are byte-identical, and revoking one device's would revoke the
    /// other's. Tokens minted before it existed carry none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jti: Option<String>,
}

pub struct JwtManager {
    encoding: EncodingKey,
    decoding: DecodingKey,
    cfg: JwtConfig,
}

impl JwtManager {
    pub fn new(cfg: JwtConfig) -> Self {
        // jsonwebtoken 10 ships NO crypto provider in its default
        // features; without one, `encode`/`decode` PANIC on first use
        // (the 2026-09-20 login/refresh 502 outage — every token
        // issuance aborted its request task). The Cargo.toml pins the
        // `rust_crypto` feature so auto-detection works, and this
        // explicit process-level install is belt-and-braces: it stays
        // correct even if future feature unification ever enables BOTH
        // provider features (ambiguous auto-detection). Idempotent-ish:
        // a second call returns Err, which we ignore.
        let _ = jsonwebtoken::crypto::rust_crypto::DEFAULT_PROVIDER.install_default();
        let encoding = EncodingKey::from_secret(cfg.secret.as_bytes());
        let decoding = DecodingKey::from_secret(cfg.secret.as_bytes());
        Self {
            encoding,
            decoding,
            cfg,
        }
    }

    pub fn issue_access(&self, user_id: Uuid) -> anyhow::Result<String> {
        let now = Utc::now();
        let exp = now + Duration::seconds(self.cfg.access_ttl_secs as i64);
        let claims = AccessTokenClaims {
            sub: user_id,
            iss: self.cfg.issuer.clone(),
            iat: now.timestamp(),
            exp: exp.timestamp(),
            typ: "access".into(),
            jti: Some(Uuid::new_v4().to_string()),
        };
        let token = encode(&Header::default(), &claims, &self.encoding)
            .map_err(|e| anyhow::anyhow!("jwt encode: {e}"))?;
        Ok(token)
    }

    pub fn verify_access(&self, token: &str) -> anyhow::Result<AccessTokenClaims> {
        let mut v = Validation::new(jsonwebtoken::Algorithm::HS256);
        v.set_issuer(&[&self.cfg.issuer]);
        // 30-second leeway to tolerate clock skew between issuer and verifier
        // (important in distributed deployments where NTP isn't perfectly synced).
        v.leeway = 30;
        let data = decode::<AccessTokenClaims>(token, &self.decoding, &v)
            .map_err(|e| anyhow::anyhow!("jwt decode: {e}"))?;
        if data.claims.typ != "access" {
            anyhow::bail!("not an access token");
        }
        Ok(data.claims)
    }

    pub fn access_ttl(&self) -> Duration {
        Duration::seconds(self.cfg.access_ttl_secs as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cfg() -> JwtConfig {
        JwtConfig {
            secret: "test-secret-not-for-production-0123456789ab".into(),
            issuer: "test-issuer".into(),
            access_ttl_secs: 900,
            refresh_ttl_secs: 7 * 24 * 3600,
            mobile_refresh_ttl_secs: 90 * 24 * 3600,
        }
    }

    /// Regression test for the 2026-09-20 outage: jsonwebtoken 10 with
    /// no crypto provider PANICS inside `encode` (the login/refresh 502s
    /// — every token issuance aborted its request task). Issuing +
    /// verifying a real HS256 token here exercises the provider path;
    /// without the `rust_crypto` feature + explicit install this test
    /// dies with "Could not automatically determine the process-level
    /// CryptoProvider" instead of passing.
    #[test]
    fn issue_and_verify_roundtrip() {
        let mgr = JwtManager::new(test_cfg());
        let user_id = Uuid::new_v4();

        let token = mgr
            .issue_access(user_id)
            .expect("jwt encode must not panic / must succeed");

        let claims = mgr
            .verify_access(&token)
            .expect("jwt decode must verify the token we just issued");
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.iss, "test-issuer");
        assert_eq!(claims.typ, "access");
        assert!(claims.exp > claims.iat);
    }

    /// Two tokens minted for one user in the same second differ, so
    /// revoking one leaves the other valid.
    #[test]
    fn tokens_minted_in_one_second_are_distinct() {
        let mgr = JwtManager::new(test_cfg());
        let user_id = Uuid::new_v4();
        let a = mgr.issue_access(user_id).expect("encode");
        let b = mgr.issue_access(user_id).expect("encode");
        assert_ne!(a, b);
    }

    /// The Worker's tokens (HS256 via `jose`, same secret and issuer, plus
    /// a `jti`) verify here, so sessions survive the cutover. The fixture
    /// token expires in 2100.
    #[test]
    fn a_worker_minted_access_token_verifies() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/wp6_ref_auth.json"))
                .expect("fixture");
        let mut cfg = test_cfg();
        cfg.secret = fixture["jwtSecret"].as_str().expect("secret").into();
        cfg.issuer = fixture["issuer"].as_str().expect("issuer").into();
        let claims = JwtManager::new(cfg)
            .verify_access(fixture["accessToken"].as_str().expect("token"))
            .expect("the Worker's token must verify");
        assert_eq!(claims.sub.to_string(), fixture["userId"].as_str().unwrap());
        assert!(claims.jti.is_some());
    }

    /// Wrong secret must be rejected — guards the verify path against
    /// accidental no-op validation.
    #[test]
    fn verify_rejects_wrong_secret() {
        let mgr = JwtManager::new(test_cfg());
        let token = mgr.issue_access(Uuid::new_v4()).expect("encode");

        let mut other = test_cfg();
        other.secret = "a-completely-different-secret-9876543210xyz".into();
        let stranger = JwtManager::new(other);
        assert!(stranger.verify_access(&token).is_err());
    }

    /// Tokens issued by a JwtManager from a DIFFERENT config (fresh
    /// provider install attempt inside `new`) must not confuse the
    /// process-level default — constructing a second manager must not
    /// error or regress the first one's roundtrip.
    #[test]
    fn second_manager_keeps_roundtrip_working() {
        let first = JwtManager::new(test_cfg());
        let _second = JwtManager::new(test_cfg());
        let token = first.issue_access(Uuid::new_v4()).expect("encode");
        assert!(first.verify_access(&token).is_ok());
    }
}
