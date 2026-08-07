//! The Cache layer — outermost wrapper. Auto-delegates every method to the
//! inner (retry) layer; overrides the methods where we actually want
//! caching: `get_user`, `get_post`, `get_user_permissions`.
//!
//! ## Cache resilience strategy
//!
//! - **Cache read failures are non-fatal.** If the cache backend (Redis)
//!   is briefly down, we fall through to the DB rather than 500'ing.
//! - **Cache write failures are non-fatal.** Subsequent reads will miss
//!   and re-fetch from the DB; the cache will warm back up.
//! - **Cache misses use `try_get` semantics** so a slow Redis doesn't
//!   block the hot path beyond a short timeout (configured per-backend).
//!
//! The cache backend is `Arc<dyn CacheBackend>` so any concrete backend
//! (Moka, Redis, ...) works behind the same type.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::{permission, post, refresh_token, role, user};

use super::error::{StoreError, StoreResult};
use super::store::{Store, UserPermissions};

pub struct CacheStore<S: Store> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: Store> CacheStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: Store> Clone for CacheStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

// ---- Cached keys ------------------------------------------------------
//
// Single source of truth for cache keys. Format is stable so multiple
// instances (or other tools) can hit the same cache.
fn user_key(id: Uuid) -> String {
    format!("entity:user:{id}")
}
fn post_key(id: Uuid) -> String {
    format!("entity:post:{id}")
}
fn perms_key(id: Uuid) -> String {
    format!("rbac:perms:{id}")
}

/// Helper: read-through cache. Returns the cached value if present,
/// `None` if missing, OR `None` if the cache errored (non-fatal — caller
/// falls through to DB). The error is logged but not propagated.
macro_rules! cache_get_or_fallthrough {
    ($self:expr, $key:expr, $type:ty) => {{
        match get_serializable::<$type>($self.cache.as_ref(), &$key).await {
            Ok(Some(v)) => {
                tracing::debug!(key = %$key, "cache hit");
                Some(v)
            }
            Ok(None) => None,
            Err(e) => {
                // Cache read failed — fall through to DB rather than 500.
                // Log at warn so it's visible but don't break the request.
                tracing::warn!(key = %$key, error = %e, "cache read failed; falling through to DB");
                None
            }
        }
    }};
}

/// Helper: write to cache without failing the request. Errors are logged
/// but not propagated. Use for write-behind semantics: the caller already
/// has the value, so the cache write is best-effort.
macro_rules! cache_set_best_effort {
    ($self:expr, $key:expr, $value:expr) => {{
        if let Err(e) =
            set_serializable($self.cache.as_ref(), &$key, &$value, Some($self.ttl)).await
        {
            tracing::warn!(key = %$key, error = %e, "cache write failed; will re-fetch on next miss");
        }
    }};
}

#[async_trait]
impl<S: Store> Store for CacheStore<S> {
    // ---------- Auto-delegated methods (no caching) ---------------------

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        self.inner.get_user_by_email(email).await
    }
    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
    ) -> StoreResult<user::Model> {
        self.inner
            .create_user(email, username, password_hash)
            .await
    }
    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.delete_user(id).await;
        if result.is_ok() {
            // Best-effort cache invalidation; if it fails, the entry
            // will expire via TTL (or be overwritten on next write).
            let _ = self.cache.delete(&user_key(id)).await;
            // Also invalidate the user's permissions cache since the user
            // no longer exists.
            let _ = self.cache.delete(&perms_key(id)).await;
        }
        result
    }
    async fn list_posts(&self, limit: u64, offset: u64) -> StoreResult<Vec<post::Model>> {
        self.inner.list_posts(limit, offset).await
    }
    async fn create_post(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> StoreResult<post::Model> {
        self.inner.create_post(author_id, title, body).await
    }
    async fn update_post(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> StoreResult<post::Model> {
        let model = self.inner.update_post(id, title, body).await?;
        // Write-through: update cache immediately so subsequent reads hit.
        cache_set_best_effort!(self, post_key(id), model);
        Ok(model)
    }
    async fn delete_post(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.delete_post(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&post_key(id)).await;
        }
        result
    }
    async fn assign_role(&self, user_id: Uuid, role_id: Uuid) -> StoreResult<()> {
        let result = self.inner.assign_role(user_id, role_id).await;
        if result.is_ok() {
            // Invalidate the permissions cache so the next check sees
            // the new role.
            let _ = self.cache.delete(&perms_key(user_id)).await;
        }
        result
    }
    async fn list_roles(&self) -> StoreResult<Vec<role::Model>> {
        self.inner.list_roles().await
    }
    async fn list_permissions(&self) -> StoreResult<Vec<permission::Model>> {
        self.inner.list_permissions().await
    }
    async fn save_refresh_token(&self, token: refresh_token::Model) -> StoreResult<()> {
        self.inner.save_refresh_token(token).await
    }
    async fn get_refresh_token(
        &self,
        id: Uuid,
    ) -> StoreResult<Option<refresh_token::Model>> {
        self.inner.get_refresh_token(id).await
    }
    async fn revoke_refresh_token(&self, id: Uuid) -> StoreResult<()> {
        self.inner.revoke_refresh_token(id).await
    }
    async fn revoke_all_refresh_tokens_for_user(&self, user_id: Uuid) -> StoreResult<()> {
        self.inner.revoke_all_refresh_tokens_for_user(user_id).await
    }

    // ---------- Cached methods (read-through, write-on-miss) -----------

    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        let key = user_key(id);
        if let Some(cached) = cache_get_or_fallthrough!(self, key, user::Model) {
            return Ok(cached);
        }
        let model = self.inner.get_user(id).await?;
        cache_set_best_effort!(self, key, model);
        Ok(model)
    }

    async fn get_post(&self, id: Uuid) -> StoreResult<post::Model> {
        let key = post_key(id);
        if let Some(cached) = cache_get_or_fallthrough!(self, key, post::Model) {
            return Ok(cached);
        }
        let model = self.inner.get_post(id).await?;
        cache_set_best_effort!(self, key, model);
        Ok(model)
    }

    async fn get_user_permissions(&self, user_id: Uuid) -> StoreResult<UserPermissions> {
        let key = perms_key(user_id);
        if let Some(cached) =
            cache_get_or_fallthrough!(self, key, UserPermissions)
        {
            return Ok(cached);
        }
        let perms = self.inner.get_user_permissions(user_id).await?;
        cache_set_best_effort!(self, key, perms);
        Ok(perms)
    }
}
