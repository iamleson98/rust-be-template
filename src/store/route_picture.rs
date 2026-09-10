//! Route-picture store — read/write access to the `route_picture`
//! table (photo gallery per bus route).
//!
//! Follows the template's store pattern: `RoutePictureStore` trait +
//! `DbRoutePictureStore` (`#[retry]`).
//!
//! The store is pure DB access — it knows nothing about object
//! storage. `RouteMediaService` owns the storage interaction and uses
//! these rows as the index of which objects exist (delete returns the
//! row so the service can garbage-collect the backing objects).

use std::sync::Arc;

use crate::entity::route_picture;
use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait RoutePictureStore: Send + Sync {
    /// Insert a new picture row. The caller (service) has already
    /// resolved dedupe via `find_by_route_and_hash`, so a UNIQUE
    /// violation here is a genuine race — surfaced as an error.
    async fn insert(&self, model: route_picture::ActiveModel) -> StoreResult<route_picture::Model>;

    /// All pictures of one route in display order (`sort_order`, then
    /// `created_at` for stable ordering of ties).
    async fn list_by_route(&self, route_id: Uuid) -> StoreResult<Vec<route_picture::Model>>;

    /// The cover picture (`sort_order = 0`) of one route, if any —
    /// used to attach a thumbnail URL to public route listings.
    async fn cover_by_route(&self, route_id: Uuid) -> StoreResult<Option<route_picture::Model>>;

    /// Cover pictures for a batch of routes in ONE query (avoids the
    /// N+1 that per-route cover lookups would cause on list pages).
    /// Returns at most one row per route id (the lowest `sort_order`).
    async fn covers_by_routes(&self, route_ids: &[Uuid]) -> StoreResult<Vec<route_picture::Model>>;

    /// Dedupe probe: same content already uploaded for this route?
    async fn find_by_route_and_hash(
        &self,
        route_id: Uuid,
        content_hash: &str,
    ) -> StoreResult<Option<route_picture::Model>>;

    /// A single picture by id (scoped to a route — the service layer
    /// uses this to reject cross-route tampering).
    async fn find_by_id_and_route(
        &self,
        route_id: Uuid,
        picture_id: Uuid,
    ) -> StoreResult<Option<route_picture::Model>>;

    /// Row count for one route (upload cap enforcement).
    async fn count_by_route(&self, route_id: Uuid) -> StoreResult<i64>;

    /// `max(sort_order) + 1` for one route — the append position.
    async fn next_sort_order(&self, route_id: Uuid) -> StoreResult<i64>;

    /// Persist a patch (`sort_order` / `alt_text`). Returns the
    /// updated model.
    async fn update(&self, model: route_picture::ActiveModel) -> StoreResult<route_picture::Model>;

    /// Delete one picture row. Returns the deleted model so the
    /// service can remove the backing objects; `None` when the row
    /// doesn't exist (or belongs to another route).
    async fn delete(
        &self,
        route_id: Uuid,
        picture_id: Uuid,
    ) -> StoreResult<Option<route_picture::Model>>;

    /// Delete every picture row of a route (route deletion GC).
    /// Returns the deleted models in display order.
    async fn delete_all_by_route(&self, route_id: Uuid) -> StoreResult<Vec<route_picture::Model>>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbRoutePictureStore {
    db: Arc<DatabaseConnection>,
}

impl DbRoutePictureStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbRoutePictureStore {}

#[async_trait]
#[retry]
impl RoutePictureStore for DbRoutePictureStore {
    async fn insert(&self, model: route_picture::ActiveModel) -> StoreResult<route_picture::Model> {
        Ok(model.insert(self.db.as_ref()).await?)
    }

    async fn list_by_route(&self, route_id: Uuid) -> StoreResult<Vec<route_picture::Model>> {
        Ok(route_picture::Entity::find()
            .filter(route_picture::Column::RouteId.eq(route_id))
            .order_by_asc(route_picture::Column::SortOrder)
            .order_by_asc(route_picture::Column::CreatedAt)
            .all(self.db.as_ref())
            .await?)
    }

    async fn cover_by_route(&self, route_id: Uuid) -> StoreResult<Option<route_picture::Model>> {
        Ok(route_picture::Entity::find()
            .filter(route_picture::Column::RouteId.eq(route_id))
            .order_by_asc(route_picture::Column::SortOrder)
            .order_by_asc(route_picture::Column::CreatedAt)
            .one(self.db.as_ref())
            .await?)
    }

    async fn covers_by_routes(&self, route_ids: &[Uuid]) -> StoreResult<Vec<route_picture::Model>> {
        if route_ids.is_empty() {
            return Ok(Vec::new());
        }
        // ONE round-trip, no N+1: fetch every picture row of the batch
        // (`route_id IN (...)`) sorted so the cover of each route comes
        // first, then keep the first row per route id in Rust. A
        // correlated `MIN(sort_order)` subquery would avoid shipping
        // the extra rows, but sea-query expresses the self-join form
        // awkwardly and the row counts here are tiny (a few pictures
        // per route x page-size routes).
        let rows = route_picture::Entity::find()
            .filter(route_picture::Column::RouteId.is_in(route_ids.to_vec()))
            .order_by_asc(route_picture::Column::RouteId)
            .order_by_asc(route_picture::Column::SortOrder)
            .order_by_asc(route_picture::Column::CreatedAt)
            .all(self.db.as_ref())
            .await?;
        let mut seen = std::collections::HashSet::new();
        let mut covers = Vec::new();
        for row in rows {
            if seen.insert(row.route_id) {
                covers.push(row);
            }
        }
        Ok(covers)
    }

    async fn find_by_route_and_hash(
        &self,
        route_id: Uuid,
        content_hash: &str,
    ) -> StoreResult<Option<route_picture::Model>> {
        Ok(route_picture::Entity::find()
            .filter(route_picture::Column::RouteId.eq(route_id))
            .filter(route_picture::Column::ContentHash.eq(content_hash))
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_by_id_and_route(
        &self,
        route_id: Uuid,
        picture_id: Uuid,
    ) -> StoreResult<Option<route_picture::Model>> {
        Ok(route_picture::Entity::find()
            .filter(route_picture::Column::Id.eq(picture_id))
            .filter(route_picture::Column::RouteId.eq(route_id))
            .one(self.db.as_ref())
            .await?)
    }

    async fn count_by_route(&self, route_id: Uuid) -> StoreResult<i64> {
        use sea_orm::PaginatorTrait;
        let n = route_picture::Entity::find()
            .filter(route_picture::Column::RouteId.eq(route_id))
            .count(self.db.as_ref())
            .await?;
        Ok(n as i64)
    }

    async fn next_sort_order(&self, route_id: Uuid) -> StoreResult<i64> {
        let max = route_picture::Entity::find()
            .filter(route_picture::Column::RouteId.eq(route_id))
            .select_only()
            .column_as(
                sea_orm::sea_query::Expr::col(route_picture::Column::SortOrder).max(),
                "max_sort",
            )
            .into_tuple::<Option<i64>>()
            .one(self.db.as_ref())
            .await?;
        Ok(max.flatten().map(|m| m + 1).unwrap_or(0))
    }

    async fn update(&self, model: route_picture::ActiveModel) -> StoreResult<route_picture::Model> {
        Ok(model.update(self.db.as_ref()).await?)
    }

    async fn delete(
        &self,
        route_id: Uuid,
        picture_id: Uuid,
    ) -> StoreResult<Option<route_picture::Model>> {
        let existing = self.find_by_id_and_route(route_id, picture_id).await?;
        let Some(m) = existing else {
            return Ok(None);
        };
        route_picture::Entity::delete_by_id(picture_id)
            .exec(self.db.as_ref())
            .await?;
        Ok(Some(m))
    }

    async fn delete_all_by_route(&self, route_id: Uuid) -> StoreResult<Vec<route_picture::Model>> {
        let rows = self.list_by_route(route_id).await?;
        route_picture::Entity::delete_many()
            .filter(route_picture::Column::RouteId.eq(route_id))
            .exec(self.db.as_ref())
            .await?;
        Ok(rows)
    }
}
