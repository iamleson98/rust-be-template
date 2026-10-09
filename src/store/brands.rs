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

use crate::cache::{get_serializable, set_serializable, CacheBackend};
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
            child_max_age: Set(None),
            child_discount_percent: Set(None),
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
            child_max_age: None,
            child_discount_percent: None,
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

    /// Current list-cache generation (missing / unparsable key = 0).
    async fn list_generation(&self) -> u64 {
        match get_serializable::<u64>(self.cache.as_ref(), &key_list_generation()).await {
            Ok(Some(v)) => v,
            _ => 0,
        }
    }

    /// Invalidate every `list_active` variant at once by advancing the
    /// generation. Old-generation entries become unreachable and age
    /// out via TTL. No expiry is set on the generation key itself so a
    /// fresh boot cannot rewind onto a still-cached old generation.
    async fn bump_list_generation(&self) {
        let gen = self.list_generation().await;
        let _ = set_serializable(
            self.cache.as_ref(),
            &key_list_generation(),
            &(gen + 1),
            None,
        )
        .await;
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
/// Generation counter for the `list_active` collection cache.
///
/// Collection keys have an unbounded `{limit}` axis (the public
/// catalog clamps it to 1..=500, so up to 500 variants exist) —
/// deleting "the" list key on write is impossible when you cannot
/// enumerate live variants. The standard fix is a generation prefix:
/// list entries live under `list_active:v{gen}:{limit}` and every
/// write bumps `gen`, making ALL variants of the old generation
/// unreachable at once (they expire by TTL on their own).
///
/// Bump races (two writers both read gen=5 and both write 6) only
/// SKIP a generation — every reader still lands on a post-write
/// generation, which is the direction that matters.
fn key_list_generation() -> String {
    "entity:brand:list_active:gen".into()
}
fn key_list_active(gen: u64, limit: u64) -> String {
    format!("entity:brand:list_active:v{gen}:{limit}")
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
        let gen = self.list_generation().await;
        let key = key_list_active(gen, limit);
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
        let model = self.inner.create(slug, name).await?;
        // New row — nothing is cached under its keys yet, but the
        // active-list membership changed.
        self.bump_list_generation().await;
        Ok(model)
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
        // A status flip changes active-list membership.
        self.bump_list_generation().await;
        Ok(model)
    }

    async fn delete(&self, id: Uuid) -> StoreResult<()> {
        // Capture the row's slug BEFORE the delete — the slug-keyed
        // cache entry must go too, but the row (and its slug) is gone
        // after. `inner` = DB truth, never the cache we are evicting.
        let old_slug = self
            .inner
            .get_by_id(id)
            .await
            .ok()
            .flatten()
            .map(|m| m.slug);
        let result = self.inner.delete(id).await;
        if result.is_ok() {
            let _ = self.cache.delete(&key_by_id(id)).await;
            if let Some(slug) = old_slug {
                // Without this, `GET /api/brands/{slug}` resurrectes the
                // deleted brand from cache for a full TTL.
                let _ = self.cache.delete(&key_by_slug(&slug)).await;
            }
            self.bump_list_generation().await;
        }
        result
    }

    async fn update_brand_rating(&self, id: Uuid, rating: Option<f64>) -> StoreResult<()> {
        // Same slug capture as `delete`: the public brand page reads by
        // slug, so evicting only the id key leaves it serving the old
        // rating for a full TTL.
        let old_slug = self
            .inner
            .get_by_id(id)
            .await
            .ok()
            .flatten()
            .map(|m| m.slug);
        self.inner.update_brand_rating(id, rating).await?;
        let _ = self.cache.delete(&key_by_id(id)).await;
        if let Some(slug) = old_slug {
            let _ = self.cache.delete(&key_by_slug(&slug)).await;
        }
        // `list_active` is ORDERED BY rating DESC — a rating change
        // reorders the homepage grid.
        self.bump_list_generation().await;
        Ok(())
    }

    async fn list_brands_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<brand::Model>> {
        // No caching for batch lookups — just delegate
        self.inner.list_brands_by_ids(ids).await
    }

    async fn insert_brand(&self, model: brand::ActiveModel) -> StoreResult<()> {
        let result = self.inner.insert_brand(model).await;
        if result.is_ok() {
            // A freshly inserted brand can be active — the homepage
            // list membership changed.
            self.bump_list_generation().await;
        }
        result
    }

    async fn update_brand_full(&self, model: brand::ActiveModel) -> StoreResult<brand::Model> {
        // Capture the OLD slug before the write: `update_brand` (the
        // admin service) may RENAME the slug, and the cache entry under
        // the old slug would otherwise serve the pre-rename brand for a
        // full TTL. Reading the id out of the ActiveModel by reference
        // keeps the model movable into `inner`.
        let id = match &model.id {
            sea_orm::ActiveValue::Set(id) => Some(*id),
            _ => None,
        };
        let old_slug = match id {
            Some(id) => self
                .inner
                .get_by_id(id)
                .await
                .ok()
                .flatten()
                .map(|m| m.slug),
            None => None,
        };
        let result = self.inner.update_brand_full(model).await?;
        let _ = self.cache.delete(&key_by_id(result.id)).await;
        let _ = self.cache.delete(&key_by_slug(&result.slug)).await;
        if let Some(old_slug) = old_slug {
            if old_slug != result.slug {
                let _ = self.cache.delete(&key_by_slug(&old_slug)).await;
            }
        }
        // Status / rating edits change list membership + ordering.
        self.bump_list_generation().await;
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
        // Broad flush for list caches (cheap; writes are rare). Bumping
        // the generation covers every `{limit}` variant — the previous
        // `key_list_active(0)` delete was a no-op: no caller ever passes
        // limit=0 (the public catalog clamps to 1..=500).
        self.bump_list_generation().await;
    }
}
