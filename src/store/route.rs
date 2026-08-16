//! Route store — read/write access to the `route` and `pickup_point` tables.
//!
//! Follows the template's store pattern: `RouteStore` trait +
//! `DbRouteStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{pickup_point, route};

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait RouteStore: Send + Sync {
    // ── Route ───────────────────────────────────────────────────

    async fn find_route_by_id(&self, id: Uuid) -> StoreResult<Option<route::Model>>;
    async fn list_routes_by_status(
        &self,
        status: &str,
        limit: u64,
    ) -> StoreResult<Vec<route::Model>>;
    async fn list_routes_by_brand(&self, brand_id: &str) -> StoreResult<Vec<route::Model>>;
    async fn list_all_routes(&self) -> StoreResult<Vec<route::Model>>;
    async fn insert_route(&self, model: route::ActiveModel) -> StoreResult<()>;
    async fn update_route(&self, model: route::ActiveModel) -> StoreResult<route::Model>;
    async fn count_routes_by_brand(&self, brand_id: &str) -> StoreResult<usize>;

    // ── PickupPoint ─────────────────────────────────────────────

    async fn list_pickup_points_by_route(
        &self,
        route_id: &str,
    ) -> StoreResult<Vec<pickup_point::Model>>;
    async fn count_pickup_points_by_route(&self, route_id: &str) -> StoreResult<usize>;
    async fn insert_pickup_point(&self, model: pickup_point::ActiveModel) -> StoreResult<()>;
    async fn find_pickup_point_by_id(&self, id: Uuid) -> StoreResult<Option<pickup_point::Model>>;
    async fn update_pickup_point(
        &self,
        model: pickup_point::ActiveModel,
    ) -> StoreResult<pickup_point::Model>;
    async fn delete_pickup_point(&self, id: Uuid) -> StoreResult<()>;
    async fn list_routes_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<route::Model>>;
    async fn count_active_routes(&self) -> StoreResult<u64>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbRouteStore {
    db: Arc<DatabaseConnection>,
}

impl DbRouteStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbRouteStore {}

#[async_trait]
#[retry]
impl RouteStore for DbRouteStore {
    // ── Route ───────────────────────────────────────────────────

    async fn find_route_by_id(&self, id: Uuid) -> StoreResult<Option<route::Model>> {
        Ok(route::Entity::find_by_id(id).one(self.db.as_ref()).await?)
    }

    async fn list_routes_by_status(
        &self,
        status: &str,
        limit: u64,
    ) -> StoreResult<Vec<route::Model>> {
        Ok(route::Entity::find()
            .filter(route::Column::Status.eq(status.to_string()))
            .order_by_asc(route::Column::Name)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_routes_by_brand(&self, brand_id: &str) -> StoreResult<Vec<route::Model>> {
        Ok(route::Entity::find()
            .filter(route::Column::BrandId.eq(brand_id.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_all_routes(&self) -> StoreResult<Vec<route::Model>> {
        Ok(route::Entity::find().all(self.db.as_ref()).await?)
    }

    #[store_macros::no_retry]
    async fn insert_route(&self, model: route::ActiveModel) -> StoreResult<()> {
        route::Entity::insert(model).exec(self.db.as_ref()).await?;
        Ok(())
    }

    async fn update_route(&self, model: route::ActiveModel) -> StoreResult<route::Model> {
        Ok(route::Entity::update(model).exec(self.db.as_ref()).await?)
    }

    async fn count_routes_by_brand(&self, brand_id: &str) -> StoreResult<usize> {
        Ok(route::Entity::find()
            .filter(route::Column::BrandId.eq(brand_id.to_string()))
            .all(self.db.as_ref())
            .await?
            .len())
    }

    // ── PickupPoint ─────────────────────────────────────────────

    async fn list_pickup_points_by_route(
        &self,
        route_id: &str,
    ) -> StoreResult<Vec<pickup_point::Model>> {
        Ok(pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.eq(route_id.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_pickup_points_by_route(&self, route_id: &str) -> StoreResult<usize> {
        Ok(pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.eq(route_id.to_string()))
            .all(self.db.as_ref())
            .await?
            .len())
    }

    #[store_macros::no_retry]
    async fn insert_pickup_point(&self, model: pickup_point::ActiveModel) -> StoreResult<()> {
        pickup_point::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn find_pickup_point_by_id(&self, id: Uuid) -> StoreResult<Option<pickup_point::Model>> {
        Ok(pickup_point::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn update_pickup_point(
        &self,
        model: pickup_point::ActiveModel,
    ) -> StoreResult<pickup_point::Model> {
        Ok(pickup_point::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn delete_pickup_point(&self, id: Uuid) -> StoreResult<()> {
        pickup_point::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn list_routes_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<route::Model>> {
        Ok(route::Entity::find()
            .filter(route::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_active_routes(&self) -> StoreResult<u64> {
        Ok(route::Entity::find()
            .filter(route::Column::Status.eq("active"))
            .count(self.db.as_ref())
            .await?)
    }
}
