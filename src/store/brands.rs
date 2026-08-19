//! Brand store — read/write access to the `brand` table with caching.
//!
//! Follows the template's store pattern: `BrandStore` trait +
//! `DbBrandStore` (`#[retry]`) + `CacheBrandStore<S>` wrapper.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{set_serializable, CacheBackend};
use crate::entity::brand;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

#[async_trait]
pub trait BrandStore: Send + Sync {
    async fn get_by_id(&self, id: Uuid) -> StoreResult<Option<brand::Model>>;
    async fn get_by_slug(&self, slug: &str) -> StoreResult<Option<brand::Model>>;
    async fn list_active(&self, limit: u64) -> StoreResult<Vec<brand::Model>>;
    async fn list_all(&self, limit: u64, offset: u64) -> StoreResult<Vec<brand::Model>>;
    async fn create(&self, slug: String, name: String) -> StoreResult<brand::Model>;
    async fn update(
        &self,
        id: Uuid,
        name: Option<String>,
        status: Option<String>,
    ) -> StoreResult<brand::Model>;
    async fn delete(&self, id: Uuid) -> StoreResult<()>;
    async fn update_brand_rating(&self, id: Uuid, rating: Option<f64>) -> StoreResult<()>;
    async fn list_brands_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<brand::Model>>;
    #[store_macros::no_retry]
    async fn insert_brand(&self, model: brand::ActiveModel) -> StoreResult<()>;
    async fn update_brand_full(&self, model: brand::ActiveModel) -> StoreResult<brand::Model>;
    async fn count_active_brands(&self) -> StoreResult<u64>;
    async fn invalidate(&self, id: Option<Uuid>, slug: Option<&str>);
}

#[derive(Clone)]
pub struct DbBrandStore {
    db: Arc<DatabaseConnection>,
}

impl DbBrandStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbBrandStore {}

#[async_trait]
#[retry]
impl BrandStore for DbBrandStore {
    async fn get_by_id(&self, id: Uuid) -> StoreResult<Option<brand::Model>> {
        Ok(brand::Entity::find_by_id(id).one(self.db.as_ref()).await?)
    }

    async fn get_by_slug(&self, slug: &str) -> StoreResult<Option<brand::Model>> {
        Ok(brand::Entity::find()
            .filter(brand::Column::Slug.eq(slug))
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_active(&self, limit: u64) -> StoreResult<Vec<brand::Model>> {
        Ok(brand::Entity::find()
            .filter(brand::Column::Status.eq("active"))
            .order_by_desc(brand::Column::Rating)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_all(&self, limit: u64, offset: u64) -> StoreResult<Vec<brand::Model>> {
        Ok(brand::Entity::find()
            .order_by_desc(brand::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn create(&self, slug: String, name: String) -> StoreResult<brand::Model> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let now_clone = now.clone();
        let model = brand::ActiveModel {
            id: Set(id),
            slug: Set(slug.clone()),
            name: Set(name.clone()),
            logo_url: Set(None),
            description: Set(None),
            contact_phone: Set(None),
            contact_email: Set(None),
            rating: Set(None),
            status: Set("active".into()),
            accent_color: Set(None),
            total_trips: Set(0),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };
        brand::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(brand::Model {
            id,
            slug,
            name,
            logo_url: None,
            description: None,
            contact_phone: None,
            contact_email: None,
            rating: None,
            status: "active".into(),
            accent_color: None,
            total_trips: 0,
            created_at: now_clone.clone(),
            updated_at: now_clone,
        })
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<String>,
        status: Option<String>,
    ) -> StoreResult<brand::Model> {
        let existing = brand::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("brand {id}")))?;
        let mut am: brand::ActiveModel = existing.into();
        if let Some(n) = name {
            am.name = Set(n);
        }
        if let Some(s) = status {
            am.status = Set(s);
        }
        am.updated_at = Set(chrono::Utc::now().to_rfc3339());
        Ok(am.update(self.db.as_ref()).await?)
    }

    async fn delete(&self, id: Uuid) -> StoreResult<()> {
        brand::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_brand_rating(&self, id: Uuid, rating: Option<f64>) -> StoreResult<()> {
        let existing = brand::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("brand {id}")))?;
        let mut am: brand::ActiveModel = existing.into();
        am.rating = Set(rating);
        am.updated_at = Set(chrono::Utc::now().to_rfc3339());
        brand::Entity::update(am).exec(self.db.as_ref()).await?;
        Ok(())
    }

    async fn list_brands_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<brand::Model>> {
        Ok(brand::Entity::find()
            .filter(brand::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn insert_brand(&self, model: brand::ActiveModel) -> StoreResult<()> {
        brand::Entity::insert(model).exec(self.db.as_ref()).await?;
        Ok(())
    }

    async fn update_brand_full(&self, model: brand::ActiveModel) -> StoreResult<brand::Model> {
        Ok(brand::Entity::update(model).exec(self.db.as_ref()).await?)
    }

    async fn count_active_brands(&self) -> StoreResult<u64> {
        Ok(brand::Entity::find()
            .filter(brand::Column::Status.eq("active"))
            .count(self.db.as_ref())
            .await?)
    }

    async fn invalidate(&self, _id: Option<Uuid>, _slug: Option<&str>) {}
}

pub struct CacheBrandStore<S: BrandStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: BrandStore> CacheBrandStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: BrandStore> Clone for CacheBrandStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

fn key_by_id(id: Uuid) -> String {
    format!("entity:brand:{id}")
}
fn key_by_slug(slug: &str) -> String {
    format!("entity:brand:slug:{slug}")
}
fn key_list_active(limit: u64) -> String {
    format!("entity:brand:list_active:{limit}")
}

#[async_trait]
impl<S: BrandStore> BrandStore for CacheBrandStore<S> {
    async fn get_by_id(&self, id: Uuid) -> StoreResult<Option<brand::Model>> {
        let key = key_by_id(id);
        let inner = self.inner.clone();
        // Use stampede-protected get_or_fetch: concurrent requests for the
        // same brand_id will all share the same DB fetch result.
        let result: Option<brand::Model> =
            crate::cache::get_or_fetch(self.cache.as_ref(), &key, self.ttl, || async move {
                inner.get_by_id(id).await.map_err(anyhow::Error::from)
            })
            .await
            .map_err(StoreError::from)?;
        Ok(result)
    }

    async fn get_by_slug(&self, slug: &str) -> StoreResult<Option<brand::Model>> {
        let key = key_by_slug(slug);
        let inner = self.inner.clone();
        let slug_owned = slug.to_string();
        let result: Option<brand::Model> =
            crate::cache::get_or_fetch(self.cache.as_ref(), &key, self.ttl, || async move {
                inner
                    .get_by_slug(&slug_owned)
                    .await
                    .map_err(anyhow::Error::from)
            })
            .await
            .map_err(StoreError::from)?;
        Ok(result)
    }

    async fn list_active(&self, limit: u64) -> StoreResult<Vec<brand::Model>> {
        let key = key_list_active(limit);
        let inner = self.inner.clone();
        let result: Vec<brand::Model> =
            crate::cache::get_or_fetch(self.cache.as_ref(), &key, self.ttl, || async move {
                inner.list_active(limit).await.map_err(anyhow::Error::from)
            })
            .await
            .map_err(StoreError::from)?;
        Ok(result)
    }

    async fn list_all(&self, limit: u64, offset: u64) -> StoreResult<Vec<brand::Model>> {
        self.inner.list_all(limit, offset).await
    }

    async fn create(&self, slug: String, name: String) -> StoreResult<brand::Model> {
        self.inner.create(slug, name).await
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<String>,
        status: Option<String>,
    ) -> StoreResult<brand::Model> {
        let model = self.inner.update(id, name, status).await?;
        let _ = self.cache.delete(&key_by_id(id)).await;
        let _ = self.cache.delete(&key_by_slug(&model.slug)).await;
        let _ = set_serializable(
            self.cache.as_ref(),
            &key_by_id(id),
            &Some(model.clone()),
            Some(self.ttl),
        )
        .await;
        Ok(model)
    }

    async fn delete(&self, id: Uuid) -> StoreResult<()> {
        let result = self.inner.delete(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&key_by_id(id)).await;
        }
        result
    }

    async fn update_brand_rating(&self, id: Uuid, rating: Option<f64>) -> StoreResult<()> {
        self.inner.update_brand_rating(id, rating).await?;
        let _ = self.cache.delete(&key_by_id(id)).await;
        Ok(())
    }

    async fn list_brands_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<brand::Model>> {
        // No caching for batch lookups — just delegate
        self.inner.list_brands_by_ids(ids).await
    }

    async fn insert_brand(&self, model: brand::ActiveModel) -> StoreResult<()> {
        self.inner.insert_brand(model).await
    }

    async fn update_brand_full(&self, model: brand::ActiveModel) -> StoreResult<brand::Model> {
        let result = self.inner.update_brand_full(model).await?;
        let _ = self.cache.delete(&key_by_id(result.id)).await;
        let _ = self.cache.delete(&key_by_slug(&result.slug)).await;
        Ok(result)
    }

    async fn count_active_brands(&self) -> StoreResult<u64> {
        self.inner.count_active_brands().await
    }

    async fn invalidate(&self, id: Option<Uuid>, slug: Option<&str>) {
        if let Some(id) = id {
            let _ = self.cache.delete(&key_by_id(id)).await;
        }
        if let Some(s) = slug {
            let _ = self.cache.delete(&key_by_slug(s)).await;
        }
        // Broad flush for list caches (cheap; writes are rare).
        let _ = self.cache.delete(&key_list_active(0)).await;
    }
}
