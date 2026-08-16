use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, Set};
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
    async fn delete_user(&self, id: Uuid) -> StoreResult<()>;
    async fn count_users(&self) -> StoreResult<u64>;
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
            phone: Set(String::new()),
            email_verified_at: Set(None),
            phone_verified_at: Set(None),
            status: Set("active".into()),
            block_reason: Set(None),
            avatar_url: Set(None),
            locale: Set("vi".into()),
            is_guest: Set(false),
            role: Set(role.clone()),
            failed_login_attempts: Set(0),
            locked_until: Set(None),
            last_login_at: Set(None),
            last_login_ip: Set(None),
            password_changed_at: Set(None),
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
                phone: String::new(),
                email_verified_at: None,
                phone_verified_at: None,
                status: "active".into(),
                block_reason: None,
                avatar_url: None,
                locale: "vi".into(),
                is_guest: false,
                role,
                failed_login_attempts: 0,
                locked_until: None,
                last_login_at: None,
                last_login_ip: None,
                password_changed_at: None,
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
                tracing::warn!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let model = self.inner.get_user(id).await?;
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await {
            tracing::warn!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
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
}
