use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::user;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

#[async_trait]
pub trait UserStore: Send + Sync {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model>;
    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>>;
    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
        role: String,
    ) -> StoreResult<user::Model>;
    /// Look up a user by their OAuth `(provider, subject)` pair.
    /// Returns `None` if no user is linked to this OAuth identity yet.
    async fn get_user_by_oauth(
        &self,
        provider: &str,
        subject: &str,
    ) -> StoreResult<Option<user::Model>>;
    /// Create a new user linked to an OAuth identity, or link an
    /// existing user (matched by email) to the OAuth identity.
    ///
    /// `email` — the email returned by the OAuth provider. Used to match
    ///   an existing user; if found, their `oauth_provider` + `oauth_subject`
    ///   are set (so future OAuth logins find them by id).
    /// `name` — the display name from the OAuth provider.
    /// `provider` — `"facebook"` / `"google"` / `"twitter"`.
    /// `subject` — the provider's stable user id.
    /// `avatar_url` — optional avatar URL from the provider.
    async fn upsert_oauth_user(
        &self,
        email: String,
        name: String,
        provider: String,
        subject: String,
        avatar_url: Option<String>,
        role: String,
    ) -> StoreResult<user::Model>;
    async fn delete_user(&self, id: Uuid) -> StoreResult<()>;
    async fn count_users(&self) -> StoreResult<u64>;
    /// Paginated list of users, newest first. Used by `UserService::list`.
    async fn list_users(&self, limit: u64, offset: u64) -> StoreResult<Vec<user::Model>>;
}

#[derive(Clone)]
pub struct DbUserStore {
    db: Arc<DatabaseConnection>,
}

impl DbUserStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbUserStore {}

#[async_trait]
#[retry]
impl UserStore for DbUserStore {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        user::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("user {id}")))
    }

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        Ok(user::Entity::find()
            .filter(user::Column::Email.eq(email))
            .one(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn create_user(
        &self,
        email: String,
        full_name: String,
        password_hash: String,
        role: String,
    ) -> StoreResult<user::Model> {
        let now = Utc::now();
        let id = Uuid::new_v4();
        let model = user::ActiveModel {
            id: Set(id),
            email: Set(email.clone()),
            full_name: Set(full_name.clone()),
            password_hash: Set(Some(password_hash.clone())),
            created_at: Set(now),
            updated_at: Set(now),
            brand_id: Set(None),
            phone: Set(None),
            email_verified_at: Set(None),
            phone_verified_at: Set(None),
            status: Set("active".into()),
            block_reason: Set(None),
            avatar_url: Set(None),
            locale: Set("vi".into()),
            is_guest: Set(false),
            is_bot: Set(false),
            role: Set(role.clone()),
            failed_login_attempts: Set(0),
            locked_until: Set(None),
            last_login_at: Set(None),
            last_login_ip: Set(None),
            password_changed_at: Set(None),
            oauth_provider: Set(None),
            oauth_subject: Set(None),
        };

        match user::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await
        {
            Ok(_) => Ok(user::Model {
                id,
                email,
                password_hash: Some(password_hash),
                created_at: now,
                updated_at: now,
                brand_id: None,
                full_name,
                phone: None,
                email_verified_at: None,
                phone_verified_at: None,
                status: "active".into(),
                block_reason: None,
                avatar_url: None,
                locale: "vi".into(),
                is_guest: false,
                is_bot: false,
                role,
                failed_login_attempts: 0,
                locked_until: None,
                last_login_at: None,
                last_login_ip: None,
                password_changed_at: None,
                oauth_provider: None,
                oauth_subject: None,
            }),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("unique") || msg.contains("duplicate") {
                    Err(StoreError::Conflict(msg))
                } else {
                    Err(e.into())
                }
            }
        }
    }

    async fn get_user_by_oauth(
        &self,
        provider: &str,
        subject: &str,
    ) -> StoreResult<Option<user::Model>> {
        Ok(user::Entity::find()
            .filter(user::Column::OauthProvider.eq(provider))
            .filter(user::Column::OauthSubject.eq(subject))
            .one(self.db.as_ref())
            .await?)
    }

    async fn upsert_oauth_user(
        &self,
        email: String,
        name: String,
        provider: String,
        subject: String,
        avatar_url: Option<String>,
        role: String,
    ) -> StoreResult<user::Model> {
        // 1. Try to find by OAuth identity (provider + subject).
        if let Some(existing) = self.get_user_by_oauth(&provider, &subject).await? {
            return Ok(existing);
        }

        // 2. Try to find by email — if the user already exists (e.g.
        //    registered via password), link the OAuth identity to them.
        if let Some(existing) = self.get_user_by_email(email.clone()).await? {
            let mut active: user::ActiveModel = existing.clone().into();
            active.oauth_provider = Set(Some(provider));
            active.oauth_subject = Set(Some(subject));
            if let Some(av) = &avatar_url {
                active.avatar_url = Set(Some(av.clone()));
            }
            active.updated_at = Set(Utc::now());
            let updated = active.update(self.db.as_ref()).await?;
            return Ok(updated);
        }

        // 3. No existing user — create a new one linked to the OAuth identity.
        let now = Utc::now();
        let id = Uuid::new_v4();
        let model = user::ActiveModel {
            id: Set(id),
            email: Set(email.clone()),
            full_name: Set(name.clone()),
            password_hash: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
            brand_id: Set(None),
            phone: Set(None),
            email_verified_at: Set(Some(now.to_rfc3339())),
            phone_verified_at: Set(None),
            status: Set("active".into()),
            block_reason: Set(None),
            avatar_url: Set(avatar_url.clone()),
            locale: Set("vi".into()),
            is_guest: Set(false),
            is_bot: Set(false),
            role: Set(role.clone()),
            failed_login_attempts: Set(0),
            locked_until: Set(None),
            last_login_at: Set(None),
            last_login_ip: Set(None),
            password_changed_at: Set(None),
            oauth_provider: Set(Some(provider.clone())),
            oauth_subject: Set(Some(subject.clone())),
        };

        match user::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await
        {
            Ok(_) => Ok(user::Model {
                id,
                email,
                password_hash: None,
                created_at: now,
                updated_at: now,
                brand_id: None,
                full_name: name,
                phone: None,
                email_verified_at: Some(now.to_rfc3339()),
                phone_verified_at: None,
                status: "active".into(),
                block_reason: None,
                avatar_url,
                locale: "vi".into(),
                is_guest: false,
                is_bot: false,
                role,
                failed_login_attempts: 0,
                locked_until: None,
                last_login_at: None,
                last_login_ip: None,
                password_changed_at: None,
                oauth_provider: Some(provider),
                oauth_subject: Some(subject),
            }),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("unique") || msg.contains("duplicate") {
                    Err(StoreError::Conflict(msg))
                } else {
                    Err(e.into())
                }
            }
        }
    }

    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        user::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn count_users(&self) -> StoreResult<u64> {
        Ok(user::Entity::find().count(self.db.as_ref()).await?)
    }

    async fn list_users(&self, limit: u64, offset: u64) -> StoreResult<Vec<user::Model>> {
        Ok(user::Entity::find()
            .order_by_desc(user::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }
}

pub struct CacheUserStore<S: UserStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: UserStore> CacheUserStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: UserStore> Clone for CacheUserStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

fn user_key(id: Uuid) -> String {
    format!("entity:user:{id}")
}

fn perms_key(id: Uuid) -> String {
    format!("rbac:perms:{id}")
}

#[async_trait]
impl<S: UserStore> UserStore for CacheUserStore<S> {
    async fn get_user(&self, id: Uuid) -> StoreResult<user::Model> {
        let key = user_key(id);
        match get_serializable::<user::Model>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => {}
            Err(e) => {
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let model = self.inner.get_user(id).await?;
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await {
            tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
        }
        Ok(model)
    }

    async fn get_user_by_email(&self, email: String) -> StoreResult<Option<user::Model>> {
        self.inner.get_user_by_email(email).await
    }

    async fn create_user(
        &self,
        email: String,
        username: String,
        password_hash: String,
        role: String,
    ) -> StoreResult<user::Model> {
        self.inner
            .create_user(email, username, password_hash, role)
            .await
    }

    async fn get_user_by_oauth(
        &self,
        provider: &str,
        subject: &str,
    ) -> StoreResult<Option<user::Model>> {
        self.inner.get_user_by_oauth(provider, subject).await
    }

    async fn upsert_oauth_user(
        &self,
        email: String,
        name: String,
        provider: String,
        subject: String,
        avatar_url: Option<String>,
        role: String,
    ) -> StoreResult<user::Model> {
        self.inner
            .upsert_oauth_user(email, name, provider, subject, avatar_url, role)
            .await
    }

    async fn delete_user(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.delete_user(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&user_key(id)).await;
            let _ = self.cache.delete(&perms_key(id)).await;
        }
        result
    }

    async fn count_users(&self) -> StoreResult<u64> {
        self.inner.count_users().await
    }

    async fn list_users(&self, limit: u64, offset: u64) -> StoreResult<Vec<user::Model>> {
        // List queries aren't cached — they need fresh results every call.
        self.inner.list_users(limit, offset).await
    }
}
