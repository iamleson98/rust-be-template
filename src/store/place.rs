//! Place store — read/write access to the `place` table.
//!
//! Follows the template's store pattern: `PlaceStore` trait +
//! `DbPlaceStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::place;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait PlaceStore: Send + Sync {
    async fn find_place_by_id(&self, id: Uuid) -> StoreResult<Option<place::Model>>;
    async fn list_places(&self, limit: u64, offset: u64) -> StoreResult<Vec<place::Model>>;
    async fn search_places_by_name(
        &self,
        pattern: &str,
        limit: u64,
    ) -> StoreResult<Vec<place::Model>>;
    async fn search_places_by_name_no_tones(
        &self,
        pattern: &str,
        limit: u64,
    ) -> StoreResult<Vec<place::Model>>;
    async fn search_places_in_bbox(
        &self,
        lat: f64,
        lon: f64,
        limit: u64,
    ) -> StoreResult<Vec<place::Model>>;
    async fn find_places_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<place::Model>>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbPlaceStore {
    db: Arc<DatabaseConnection>,
}

impl DbPlaceStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbPlaceStore {}

#[async_trait]
#[retry]
impl PlaceStore for DbPlaceStore {
    async fn find_place_by_id(&self, id: Uuid) -> StoreResult<Option<place::Model>> {
        Ok(place::Entity::find_by_id(id).one(self.db.as_ref()).await?)
    }

    async fn list_places(&self, limit: u64, offset: u64) -> StoreResult<Vec<place::Model>> {
        Ok(place::Entity::find()
            .order_by_desc(place::Column::Population)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn search_places_by_name(
        &self,
        pattern: &str,
        limit: u64,
    ) -> StoreResult<Vec<place::Model>> {
        Ok(place::Entity::find()
            .filter(place::Column::Name.contains(pattern))
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn search_places_by_name_no_tones(
        &self,
        pattern: &str,
        limit: u64,
    ) -> StoreResult<Vec<place::Model>> {
        Ok(place::Entity::find()
            .filter(place::Column::NameNoTones.contains(pattern))
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn search_places_in_bbox(
        &self,
        lat: f64,
        lon: f64,
        limit: u64,
    ) -> StoreResult<Vec<place::Model>> {
        Ok(place::Entity::find()
            .filter(place::Column::Lat.between(lat - 1.0, lat + 1.0))
            .filter(place::Column::Lon.between(lon - 1.0, lon + 1.0))
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn find_places_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<place::Model>> {
        Ok(place::Entity::find()
            .filter(place::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }
}
