//! Schedule store — read/write access to the `schedule` and `bus_layout` tables.
//!
//! Follows the template's store pattern: `ScheduleStore` trait +
//! `DbScheduleStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{bus_layout, schedule};

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait ScheduleStore: Send + Sync {
    // ── Schedule ────────────────────────────────────────────────

    async fn find_schedule_by_id(&self, id: Uuid) -> StoreResult<Option<schedule::Model>>;
    async fn list_schedules_by_route(&self, route_id: &str) -> StoreResult<Vec<schedule::Model>>;
    async fn count_schedules_by_route(&self, route_id: &str) -> StoreResult<usize>;
    async fn list_schedules_by_routes(
        &self,
        route_ids: Vec<Uuid>,
    ) -> StoreResult<Vec<schedule::Model>>;
    async fn insert_schedule(&self, model: schedule::ActiveModel) -> StoreResult<()>;
    async fn update_schedule(&self, model: schedule::ActiveModel) -> StoreResult<schedule::Model>;
    async fn delete_schedule(&self, id: Uuid) -> StoreResult<()>;

    // ── BusLayout ───────────────────────────────────────────────

    async fn find_bus_layout_by_id(&self, id: Uuid) -> StoreResult<Option<bus_layout::Model>>;
    async fn list_bus_layouts(&self) -> StoreResult<Vec<bus_layout::Model>>;
    async fn count_bus_layouts_by_brand(&self, brand_id: &str) -> StoreResult<usize>;
    async fn list_schedules_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<schedule::Model>>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbScheduleStore {
    db: Arc<DatabaseConnection>,
}

impl DbScheduleStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbScheduleStore {}

#[async_trait]
#[retry]
impl ScheduleStore for DbScheduleStore {
    // ── Schedule ────────────────────────────────────────────────

    async fn find_schedule_by_id(&self, id: Uuid) -> StoreResult<Option<schedule::Model>> {
        Ok(schedule::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_schedules_by_route(&self, route_id: &str) -> StoreResult<Vec<schedule::Model>> {
        Ok(schedule::Entity::find()
            .filter(schedule::Column::RouteId.eq(route_id.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_schedules_by_route(&self, route_id: &str) -> StoreResult<usize> {
        // SELECT COUNT(*) WHERE route_id = ? — single round trip, no row
        // materialisation. Used by admin_service::list_routes which previously
        // called list_schedules_by_route(...).len() and loaded every schedule
        // row just to count them (N routes × M schedules = N*M row fetches).
        Ok(schedule::Entity::find()
            .filter(schedule::Column::RouteId.eq(route_id.to_string()))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn list_schedules_by_routes(
        &self,
        route_ids: Vec<Uuid>,
    ) -> StoreResult<Vec<schedule::Model>> {
        Ok(schedule::Entity::find()
            .filter(schedule::Column::RouteId.is_in(route_ids))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_schedule(&self, model: schedule::ActiveModel) -> StoreResult<()> {
        schedule::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_schedule(&self, model: schedule::ActiveModel) -> StoreResult<schedule::Model> {
        Ok(schedule::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn delete_schedule(&self, id: Uuid) -> StoreResult<()> {
        schedule::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    // ── BusLayout ───────────────────────────────────────────────

    async fn find_bus_layout_by_id(&self, id: Uuid) -> StoreResult<Option<bus_layout::Model>> {
        Ok(bus_layout::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_bus_layouts(&self) -> StoreResult<Vec<bus_layout::Model>> {
        Ok(bus_layout::Entity::find().all(self.db.as_ref()).await?)
    }

    async fn count_bus_layouts_by_brand(&self, brand_id: &str) -> StoreResult<usize> {
        // Use `count()` instead of the previous `.all().len()` pattern.
        Ok(bus_layout::Entity::find()
            .filter(bus_layout::Column::BrandId.eq(brand_id.to_string()))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn list_schedules_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<schedule::Model>> {
        Ok(schedule::Entity::find()
            .filter(schedule::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }
}
