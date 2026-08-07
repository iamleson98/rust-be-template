//! JWT validator with **revocation cache only**.
//!
//! ## Design rationale
//!
//! We deliberately do NOT cache verified JWT claims. Here's why:
//!
//! - **HS256 verify is already fast** (~5-10µs). At 10k req/s that's
//!   ~50ms of CPU/sec — about 5% of one core. Caching turns this into
//!   ~50ns hashmap lookups, saving 99% of that — but at typical QPS
//!   the absolute saving is negligible and not worth the complexity.
//! - **JWT is stateless by design.** The whole point of JWT vs. server-
//!   side sessions is that no server lookup is needed. Caching verified
//!   claims re-introduces server state, defeating the purpose.
//! - **Revocation still requires server state.** JWT alone can't do
//!   logout (the token is valid until `exp`). So we DO need a server-
//!   side revocation cache — but only for revocation, not for verified
//!   claims. This minimizes the state we keep.
//! - **`peek_claims` (insecure decode) is a footgun.** Our previous
//!   version decoded the JWT without verifying the signature to peek
//!   at `sub` + `iat` for the per-user revocation check. While safe in
//!   practice (because we always do full verify after), it's a security
//!   smell. The cleaner design is: verify first, THEN check revocation
//!   against the trusted claims.
//!
//! ## When you SHOULD cache verified claims
//!
//! - You use **RS256/ES256** (asymmetric). Those are 50-100x slower
//!   than HS256 — caching pays off at much lower QPS.
//! - You use **OAuth2 token introspection** (`/tokeninfo` endpoint).
//!   That's 1-5ms per call — caching is essential.
//! - You're at **>50k req/s per node** with HS256 — micro-optimization
//!   territory, and even then benchmark before assuming it helps.
//!
//! For this codebase at typical QPS, the simpler design wins.

use std::sync::Arc;
use std::time::Duration;

use moka::future::Cache;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::auth::jwt::{AccessTokenClaims, JwtManager};
use crate::config::JwtConfig;

pub struct JwtValidator {
    manager: Arc<JwtManager>,
    /// `token_hash -> ()` for explicitly revoked tokens (e.g. admin
    /// force-logout of a specific session). Negative cache only.
    revoked: Cache<String, ()>,
    /// `user_id -> revoked_at timestamp`. When set, any token for that
    /// user with `iat <= revoked_at` is rejected. This is how logout
    /// immediately invalidates an access token despite JWT being stateless.
    ///
    /// TTL bounded by the access token's max lifetime — after that,
    /// the token would have expired anyway, so the revocation entry
    /// can be evicted.
    user_revoked_at: Cache<Uuid, i64>,
}

impl JwtValidator {
    pub fn new(manager: Arc<JwtManager>, cfg: &JwtConfig) -> Self {
        // TTL: bounded by the access token's lifetime. After the token
        // would have expired, the revocation entry is useless.
        let revocation_ttl = Duration::from_secs(cfg.access_ttl_secs);

        let revoked = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(revocation_ttl)
            .eviction_policy(moka::policy::EvictionPolicy::tiny_lfu())
            .name("jwt_revoked_tokens")
            .build();

        let user_revoked_at = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(revocation_ttl)
            .eviction_policy(moka::policy::EvictionPolicy::tiny_lfu())
            .name("jwt_user_revoked_at")
            .build();

        Self {
            manager,
            revoked,
            user_revoked_at,
        }
    }

    /// Verify the token's signature + expiry, then check revocation.
    ///
    /// Order:
    ///   1. Full JWT verify (signature + exp + issuer + typ).
    ///      Returns trusted `AccessTokenClaims`.
    ///   2. Per-token revocation check — was this specific token revoked?
    ///   3. Per-user revocation check — was the user logged out after
    ///      this token was issued?
    ///
    /// Step 1 always runs (no cache shortcut). The cost is ~5-10µs of
    /// CPU per request — fast enough that caching wouldn't meaningfully
    /// help, and skipping the cache keeps the design stateless + simple.
    pub async fn verify(&self, token: &str) -> anyhow::Result<AccessTokenClaims> {
        // 1. Full signature verification. This is the slow step (~5-10µs)
        //    and we deliberately don't cache its result.
        let claims = self.manager.verify_access(token)?;
        let hash = token_hash(token);

        // 2. Per-token revocation.
        if self.revoked.get(&hash).await.is_some() {
            tracing::debug!(hash = %hash, "jwt rejected: token revoked");
            anyhow::bail!("token revoked");
        }

        // 3. Per-user revocation. The claims are now trusted (signature
        //    verified in step 1), so reading `iat` from them is safe.
        //    No need for insecure peek.
        if let Some(revoked_at) = self.user_revoked_at.get(&claims.sub).await {
            // `<=` (not `<`) handles the case where login + logout happen
            // in the same second.
            if claims.iat <= revoked_at {
                tracing::debug!(
                    user_id = %claims.sub,
                    token_iat = claims.iat,
                    revoked_at,
                    "jwt rejected: user session revoked (logout)"
                );
                anyhow::bail!("user session revoked");
            }
        }

        Ok(claims)
    }

    /// Mark a specific token as revoked. Used for fine-grained revocation
    /// (e.g. revoking one session without logging out the user everywhere).
    pub async fn revoke(&self, token: &str) {
        let hash = token_hash(token);
        self.revoked.insert(hash, ()).await;
    }

    /// Revoke all tokens for a user. Records `revoked_at = now` in the
    /// per-user cache; any token with `iat <= revoked_at` is rejected.
    ///
    /// This is how logout immediately invalidates an access token despite
    /// JWT being stateless.
    pub async fn revoke_all_for_user(&self, user_id: Uuid) {
        let now = chrono::Utc::now().timestamp();
        self.user_revoked_at.insert(user_id, now).await;
        tracing::info!(user_id = %user_id, "revoked all JWTs for user (logout)");
    }
}

fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable() {
        let a = token_hash("abc");
        let b = token_hash("abc");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn hash_differs_for_different_tokens() {
        assert_ne!(token_hash("token-a"), token_hash("token-b"));
    }
}
