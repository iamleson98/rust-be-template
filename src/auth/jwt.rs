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
}

pub struct JwtManager {
    encoding: EncodingKey,
    decoding: DecodingKey,
    cfg: JwtConfig,
}

impl JwtManager {
    pub fn new(cfg: JwtConfig) -> Self {
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
        };
        let token = encode(&Header::default(), &claims, &self.encoding)
            .map_err(|e| anyhow::anyhow!("jwt encode: {e}"))?;
        Ok(token)
    }

    pub fn verify_access(&self, token: &str) -> anyhow::Result<AccessTokenClaims> {
        let mut v = Validation::new(jsonwebtoken::Algorithm::HS256);
        v.set_issuer(&[&self.cfg.issuer]);
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
