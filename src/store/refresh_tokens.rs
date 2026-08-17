use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::refresh_tokens;

use super::error::StoreResult;
use super::retry::RetryPolicy;

#[async_trait]
pub trait RefreshTokenStore: Send + Sync {
    async fn save_refresh_token(&self, token: refresh_tokens::Model) -> StoreResult<()>;
    async fn get_refresh_token(&self, id: Uuid) -> StoreResult<Option<refresh_tokens::Model>>;
    async fn revoke_refresh_token(&self, id: Uuid) -> StoreResult<()>;
    async fn revoke_all_refresh_tokens_for_user(&self, user_id: Uuid) -> StoreResult<()>;

    /// Atomically revoke an unrevoked, unexpired token. Returns `Some(user_id)`
    /// on success, `None` if the row was already revoked/expired (or doesn't
    /// exist). The conditional UPDATE eliminates the TOCTOU window of the
    /// previous `get_refresh_token` + `revoke_refresh_token` pair — two
    /// concurrent refresh requests with the same token both used to pass
    /// the validation check and both issued fresh sessions.
    async fn try_revoke_refresh_token(&self, id: Uuid) -> StoreResult<Option<Uuid>>;
}

#[derive(Clone)]
pub struct DbRefreshTokenStore {
    db: Arc<DatabaseConnection>,
}

impl DbRefreshTokenStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbRefreshTokenStore {}

#[async_trait]
#[retry]
impl RefreshTokenStore for DbRefreshTokenStore {
    #[store_macros::no_retry]
    async fn save_refresh_token(&self, token: refresh_tokens::Model) -> StoreResult<()> {
        let am = refresh_tokens::ActiveModel {
            id: Set(token.id),
            user_id: Set(token.user_id),
            token_hash: Set(token.token_hash),
            issued_at: Set(token.issued_at),
            expires_at: Set(token.expires_at),
            revoked: Set(token.revoked),
            user_agent: Set(token.user_agent),
            ip: Set(token.ip),
        };
        refresh_tokens::Entity::insert(am)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn get_refresh_token(&self, id: Uuid) -> StoreResult<Option<refresh_tokens::Model>> {
        Ok(refresh_tokens::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn revoke_refresh_token(&self, id: Uuid) -> StoreResult<()> {
        refresh_tokens::Entity::update_many()
            .col_expr(refresh_tokens::Column::Revoked, Expr::value(true))
            .filter(refresh_tokens::Column::Id.eq(id))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn revoke_all_refresh_tokens_for_user(&self, user_id: Uuid) -> StoreResult<()> {
        refresh_tokens::Entity::update_many()
            .col_expr(refresh_tokens::Column::Revoked, Expr::value(true))
            .filter(refresh_tokens::Column::UserId.eq(user_id))
            .filter(refresh_tokens::Column::Revoked.eq(false))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn try_revoke_refresh_token(&self, id: Uuid) -> StoreResult<Option<Uuid>> {
        // Atomic conditional UPDATE — only matches if the token is still
        // unrevoked + unexpired. Returns the user_id of the matched row
        // (single round trip; no TOCTOU window between check + revoke).
        let now_iso = chrono::Utc::now();
        let res = refresh_tokens::Entity::update_many()
            .col_expr(refresh_tokens::Column::Revoked, Expr::value(true))
            .filter(refresh_tokens::Column::Id.eq(id))
            .filter(refresh_tokens::Column::Revoked.eq(false))
            .filter(refresh_tokens::Column::ExpiresAt.gt(now_iso))
            .exec(self.db.as_ref())
            .await?;
        // UPDATE in SeaORM doesn't support RETURNING across both SQLite and
        // Postgres uniformly, so we fall back to a follow-up read for the
        // user_id. The atomic UPDATE above is what closes the race — the
        // read here is safe because if `rows_affected == 0` no one else can
        // claim it; if `rows_affected == 1` we know the row is now `revoked=true`,
        // so the user_id lookup is consistent.
        if res.rows_affected == 0 {
            return Ok(None);
        }
        let model = refresh_tokens::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?;
        Ok(model.map(|m| m.user_id))
    }
}

pub struct CacheRefreshTokenStore<S: RefreshTokenStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: RefreshTokenStore> CacheRefreshTokenStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: RefreshTokenStore> Clone for CacheRefreshTokenStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

fn refresh_token_key(id: Uuid) -> String {
    format!("auth:refresh:{id}")
}

#[async_trait]
impl<S: RefreshTokenStore> RefreshTokenStore for CacheRefreshTokenStore<S> {
    async fn save_refresh_token(&self, token: refresh_tokens::Model) -> StoreResult<()> {
        let token_id = token.id;
        self.inner.save_refresh_token(token.clone()).await?;

        let key = refresh_token_key(token_id);
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &token, Some(self.ttl)).await {
            tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
        }

        Ok(())
    }

    async fn get_refresh_token(&self, id: Uuid) -> StoreResult<Option<refresh_tokens::Model>> {
        let key = refresh_token_key(id);
        match get_serializable::<refresh_tokens::Model>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(Some(v)),
            Ok(None) => {}
            Err(e) => {
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let model = self.inner.get_refresh_token(id).await?;
        if let Some(ref token) = model {
            if let Err(e) = set_serializable(self.cache.as_ref(), &key, token, Some(self.ttl)).await
            {
                tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
            }
        }
        Ok(model)
    }

    async fn revoke_refresh_token(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.revoke_refresh_token(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&refresh_token_key(id)).await;
        }
        result
    }

    async fn revoke_all_refresh_tokens_for_user(&self, user_id: Uuid) -> StoreResult<()> {
        self.inner.revoke_all_refresh_tokens_for_user(user_id).await
    }

    async fn try_revoke_refresh_token(&self, id: Uuid) -> StoreResult<Option<Uuid>> {
        let result = self.inner.try_revoke_refresh_token(id).await;
        if result.is_ok() {
            // Bust the cache so subsequent reads see the new revoked state.
            let _ = self.cache.delete(&refresh_token_key(id)).await;
        }
        result
    }
}
