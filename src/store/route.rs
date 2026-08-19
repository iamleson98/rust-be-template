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

    /// Search active routes where the name contains both `from` and `to`
    /// substrings (case-insensitive). Replaces the previous "load 1000
    /// active routes and filter in Rust" pattern that allocated
    /// `to_lowercase()` strings on every iteration.
    async fn search_active_routes_by_name(
        &self,
        from_lower: &str,
        to_lower: &str,
        limit: u64,
    ) -> StoreResult<Vec<route::Model>>;
    async fn insert_route(&self, model: route::ActiveModel) -> StoreResult<()>;
    async fn update_route(&self, model: route::ActiveModel) -> StoreResult<route::Model>;
    async fn delete_route(&self, id: Uuid) -> StoreResult<()>;
    async fn count_routes_by_brand(&self, brand_id: &str) -> StoreResult<usize>;

    /// Batched version of `count_routes_by_brand` — single SQL
    /// `SELECT brand_id, COUNT(*) GROUP BY brand_id WHERE brand_id IN (...)`
    /// instead of N round-trips. Returns a map keyed by brand_id string.
    async fn count_routes_by_brand_map(
        &self,
        brand_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>>;

    // ── PickupPoint ─────────────────────────────────────────────

    async fn list_pickup_points_by_route(
        &self,
        route_id: &str,
    ) -> StoreResult<Vec<pickup_point::Model>>;
    async fn count_pickup_points_by_route(&self, route_id: &str) -> StoreResult<usize>;

    /// Batched version — `SELECT route_id, COUNT(*) FROM pickup_point
    /// WHERE route_id IN (?) GROUP BY route_id`. Replaces N per-route
    /// round-trips in admin_service::list_routes.
    async fn count_pickup_points_by_route_map(
        &self,
        route_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>>;
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

    async fn search_active_routes_by_name(
        &self,
        from_lower: &str,
        to_lower: &str,
        limit: u64,
    ) -> StoreResult<Vec<route::Model>> {
        // SQL-side ILIKE filter — both from and to must appear in the
        // route name (case-insensitive). Replaces the previous
        // "load 1000 routes + to_lowercase().contains() in Rust" pattern.
        // On SQLite, LIKE is case-insensitive for ASCII by default; on
        // Postgres, ILIKE is the case-insensitive variant.
        // We use LIKE (portable across both backends) with already-lowercased
        // inputs — the route names are stored in their original case, so we
        // also lowercase the column via `LOWER(name) LIKE '%from%'`.
        use sea_orm::sea_query::Expr;
        Ok(route::Entity::find()
            .filter(route::Column::Status.eq("active"))
            .filter(Expr::cust_with_values(
                "LOWER(name) LIKE '%' || ? || '%'",
                [from_lower.to_string()],
            ))
            .filter(Expr::cust_with_values(
                "LOWER(name) LIKE '%' || ? || '%'",
                [to_lower.to_string()],
            ))
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_route(&self, model: route::ActiveModel) -> StoreResult<()> {
        route::Entity::insert(model).exec(self.db.as_ref()).await?;
        Ok(())
    }

    async fn update_route(&self, model: route::ActiveModel) -> StoreResult<route::Model> {
        Ok(route::Entity::update(model).exec(self.db.as_ref()).await?)
    }

    #[store_macros::no_retry]
    async fn delete_route(&self, id: Uuid) -> StoreResult<()> {
        route::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn count_routes_by_brand(&self, brand_id: &str) -> StoreResult<usize> {
        // Use `count()` (SELECT COUNT(*)) instead of the previous
        // `.all().len()` pattern that materialised every matching row
        // in memory just to count them.
        Ok(route::Entity::find()
            .filter(route::Column::BrandId.eq(brand_id.to_string()))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn count_routes_by_brand_map(
        &self,
        brand_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>> {
        if brand_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        // `SELECT brand_id, COUNT(*) FROM route WHERE brand_id IN (?) GROUP BY brand_id`
        use sea_orm::sea_query::Expr;
        let rows: Vec<(String, i64)> = route::Entity::find()
            .filter(route::Column::BrandId.is_in(brand_ids.clone()))
            .select_only()
            .column(route::Column::BrandId)
            .column_as(Expr::col(route::Column::Id).count(), "count")
            .group_by(route::Column::BrandId)
            .into_tuple::<(String, i64)>()
            .all(self.db.as_ref())
            .await?;
        let mut map: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(brand_ids.len());
        for id in brand_ids {
            map.insert(id, 0);
        }
        for (id, count) in rows {
            map.insert(id, count as usize);
        }
        Ok(map)
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
        // Same fix as count_routes_by_brand — `count()` instead of `all().len()`.
        Ok(pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.eq(route_id.to_string()))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn count_pickup_points_by_route_map(
        &self,
        route_ids: Vec<String>,
    ) -> StoreResult<std::collections::HashMap<String, usize>> {
        if route_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        use sea_orm::sea_query::Expr;
        let rows: Vec<(String, i64)> = pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.is_in(route_ids.clone()))
            .select_only()
            .column(pickup_point::Column::RouteId)
            .column_as(Expr::col(pickup_point::Column::Id).count(), "count")
            .group_by(pickup_point::Column::RouteId)
            .into_tuple::<(String, i64)>()
            .all(self.db.as_ref())
            .await?;
        let mut map: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(route_ids.len());
        for id in route_ids {
            map.insert(id, 0);
        }
        for (id, count) in rows {
            map.insert(id, count as usize);
        }
        Ok(map)
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
