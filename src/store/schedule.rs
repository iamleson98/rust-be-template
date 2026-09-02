//! Schedule store — read/write access to the `schedule` and `bus_layout` tables.
//!
//! Follows the template's store pattern: `ScheduleStore` trait +
//! `DbScheduleStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect,
};
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

    /// Batched version of `count_schedules_by_route` — single SQL
    /// `SELECT route_id, COUNT(*) GROUP BY route_id WHERE route_id IN (...)`
    /// instead of N round-trips.
    async fn count_schedules_by_route_map(
        &self,
        route_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>>;
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

    /// Batched version — `SELECT brand_id, COUNT(*) FROM bus_layout
    /// WHERE brand_id IN (?) GROUP BY brand_id`. Replaces N per-brand
    /// round-trips in admin_service::list_brands.
    async fn count_bus_layouts_by_brand_map(
        &self,
        brand_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>>;
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
        // Parse to Uuid — see `parse_uuid` (a TEXT parameter never
        // matches the BLOB-stored uuid column on SQLite).
        let route_uuid = super::parse_uuid(route_id)?;
        Ok(schedule::Entity::find()
            .filter(schedule::Column::RouteId.eq(route_uuid))
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_schedules_by_route(&self, route_id: &str) -> StoreResult<usize> {
        // SELECT COUNT(*) WHERE route_id = ? — single round trip, no row
        // materialisation. Used by admin_service::list_routes which previously
        // called list_schedules_by_route(...).len() and loaded every schedule
        // row just to count them (N routes × M schedules = N*M row fetches).
        let route_uuid = super::parse_uuid(route_id)?;
        Ok(schedule::Entity::find()
            .filter(schedule::Column::RouteId.eq(route_uuid))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn count_schedules_by_route_map(
        &self,
        route_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>> {
        if route_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        use sea_orm::sea_query::Expr;
        // GROUP BY key decodes as `Uuid` — on SQLite the column is a 16-byte
        // BLOB (decoding as `String` fails); on Postgres both work. See
        // `parse_uuid`. Map back to the caller's string keys afterwards.
        let route_uuids: Vec<Uuid> = route_ids
            .iter()
            .map(|id| super::parse_uuid(id))
            .collect::<StoreResult<Vec<_>>>()?;
        let rows: Vec<(Uuid, i64)> = schedule::Entity::find()
            .filter(schedule::Column::RouteId.is_in(route_uuids))
            .select_only()
            .column(schedule::Column::RouteId)
            .column_as(Expr::col(schedule::Column::Id).count(), "count")
            .group_by(schedule::Column::RouteId)
            .into_tuple::<(Uuid, i64)>()
            .all(self.db.as_ref())
            .await?;
        let mut map: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(route_ids.len());
        for id in route_ids {
            map.insert(id, 0);
        }
        for (id, count) in rows {
            map.insert(id.to_string(), count as usize);
        }
        Ok(map)
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
        let brand_uuid = super::parse_uuid(brand_id)?;
        Ok(bus_layout::Entity::find()
            .filter(bus_layout::Column::BrandId.eq(brand_uuid))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn count_bus_layouts_by_brand_map(
        &self,
        brand_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>> {
        if brand_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        use sea_orm::sea_query::Expr;
        // GROUP BY key decodes as `Uuid` (BLOB on SQLite — see `parse_uuid`).
        let brand_uuids: Vec<Uuid> = brand_ids
            .iter()
            .map(|id| super::parse_uuid(id))
            .collect::<StoreResult<Vec<_>>>()?;
        let rows: Vec<(Uuid, i64)> = bus_layout::Entity::find()
            .filter(bus_layout::Column::BrandId.is_in(brand_uuids))
            .select_only()
            .column(bus_layout::Column::BrandId)
            .column_as(Expr::col(bus_layout::Column::Id).count(), "count")
            .group_by(bus_layout::Column::BrandId)
            .into_tuple::<(Uuid, i64)>()
            .all(self.db.as_ref())
            .await?;
        let mut map: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(brand_ids.len());
        for id in brand_ids {
            map.insert(id, 0);
        }
        for (id, count) in rows {
            map.insert(id.to_string(), count as usize);
        }
        Ok(map)
    }

    async fn list_schedules_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<schedule::Model>> {
        Ok(schedule::Entity::find()
            .filter(schedule::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }
}
