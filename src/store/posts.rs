use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, QueryOrder, QuerySelect, Set};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::posts;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

#[async_trait]
pub trait PostStore: Send + Sync {
    async fn get_post(&self, id: Uuid) -> StoreResult<posts::Model>;
    async fn list_posts(&self, limit: u64, offset: u64) -> StoreResult<Vec<posts::Model>>;
    async fn create_post(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> StoreResult<posts::Model>;
    async fn update_post(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> StoreResult<posts::Model>;
    async fn delete_post(&self, id: Uuid) -> StoreResult<()>;
}

#[derive(Clone)]
pub struct DbPostStore {
    db: Arc<DatabaseConnection>,
}

impl DbPostStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbPostStore {}

#[async_trait]
#[retry]
impl PostStore for DbPostStore {
    async fn get_post(&self, id: Uuid) -> StoreResult<posts::Model> {
        posts::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("post {id}")))
    }

    async fn list_posts(&self, limit: u64, offset: u64) -> StoreResult<Vec<posts::Model>> {
        let rows = posts::Entity::find()
            .order_by_desc(posts::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(self.db.as_ref())
            .await?;
        Ok(rows)
    }

    #[store_macros::no_retry]
    async fn create_post(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> StoreResult<posts::Model> {
        let now = Utc::now();
        let id = Uuid::new_v4();
        let model = posts::ActiveModel {
            id: Set(id),
            author_id: Set(author_id),
            title: Set(title.clone()),
            body: Set(body.clone()),
            created_at: Set(now),
            updated_at: Set(now),
        };

        posts::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;

        Ok(posts::Model {
            id,
            author_id,
            title,
            body,
            created_at: now,
            updated_at: now,
        })
    }

    async fn update_post(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> StoreResult<posts::Model> {
        let existing = posts::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("post {id}")))?;

        let mut am: posts::ActiveModel = existing.into();
        if let Some(t) = title {
            am.title = Set(t);
        }
        if let Some(b) = body {
            am.body = Set(b);
        }
        am.updated_at = Set(Utc::now());

        Ok(am.update(self.db.as_ref()).await?)
    }

    async fn delete_post(&self, id: Uuid) -> StoreResult<()> {
        posts::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }
}

pub struct CachePostStore<S: PostStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: PostStore> CachePostStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: PostStore> Clone for CachePostStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

fn post_key(id: Uuid) -> String {
    format!("entity:post:{id}")
}

#[async_trait]
impl<S: PostStore> PostStore for CachePostStore<S> {
    async fn get_post(&self, id: Uuid) -> StoreResult<posts::Model> {
        let key = post_key(id);
        match get_serializable::<posts::Model>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => {}
            Err(e) => {
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB");
            }
        }

        let model = self.inner.get_post(id).await?;
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await {
            tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
        }
        Ok(model)
    }

    async fn list_posts(&self, limit: u64, offset: u64) -> StoreResult<Vec<posts::Model>> {
        self.inner.list_posts(limit, offset).await
    }

    async fn create_post(
        &self,
        author_id: Uuid,
        title: String,
        body: String,
    ) -> StoreResult<posts::Model> {
        self.inner.create_post(author_id, title, body).await
    }

    async fn update_post(
        &self,
        id: Uuid,
        title: Option<String>,
        body: Option<String>,
    ) -> StoreResult<posts::Model> {
        let model = self.inner.update_post(id, title, body).await?;
        let key = post_key(id);
        if let Err(e) = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await {
            tracing::debug!(key = %key, error = %e, "cache write failed; will re-fetch on next miss");
        }
        Ok(model)
    }

    async fn delete_post(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.delete_post(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&post_key(id)).await;
        }
        result
    }
}
