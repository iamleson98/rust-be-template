//! Route store — read/write access to the `route` and `pickup_point` tables.
//!
//! Follows the template's store pattern: `RouteStore` trait +
//! `DbRouteStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Statement,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{pickup_point, route};

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  DTO for geo search
// ────────────────────────────────────────────────────────────────

/// Pickup point data joined with route info — returned by
/// `find_pickup_points_in_bbox`. Used by the geospatial trip search
/// to compute haversine distances + sort by combined pickup+drop distance.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PickupPointWithRoute {
    pub pickup_id: Uuid,
    pub route_id: Uuid,
    pub route_name: String,
    pub brand_id: Option<Uuid>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub stop_order: i64,
    pub kind: Option<String>,
    pub name: Option<String>,
    pub route_status: String,
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

/// A page of routes plus the total matching-row count (before
/// pagination) — powers the admin routes table's server-side paging.
#[derive(Debug, Clone)]
pub struct RoutePage {
    pub items: Vec<route::Model>,
    /// Total rows matching the filter (ignores limit/offset).
    pub total: u64,
}

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

    /// Admin list with an optional brand filter + case-insensitive
    /// search over the route name, the start/end city slugs and the
    /// owning brand's name, ordered by `created_at` (newest first) for
    /// stable pages. `limit=None` returns every matching row (legacy
    /// "fetch all" consumers such as the schedule form).
    async fn list_routes_page(
        &self,
        brand_id: Option<&str>,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> StoreResult<RoutePage>;

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

    /// Find pickup points within a bounding box (lat/lon range).
    /// Returns route_id + pickup_point data for all points inside the box.
    /// Used by the geospatial trip search — the caller then computes
    /// haversine distances in Rust + sorts by combined pickup+drop distance.
    ///
    /// Two bounding boxes are passed: one for the pickup location, one for
    /// the drop location. The query returns ALL pickup_points in EITHER
    /// box — the Rust caller filters by direction (stop_order) + distance.
    async fn find_pickup_points_in_bbox(
        &self,
        from_lat_min: f64,
        from_lat_max: f64,
        from_lon_min: f64,
        from_lon_max: f64,
        to_lat_min: f64,
        to_lat_max: f64,
        to_lon_min: f64,
        to_lon_max: f64,
    ) -> StoreResult<Vec<PickupPointWithRoute>>;
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
        // Parse to Uuid — see `parse_uuid` (TEXT param ≠ BLOB column on SQLite).
        let brand_uuid = super::parse_uuid(brand_id)?;
        Ok(route::Entity::find()
            .filter(route::Column::BrandId.eq(brand_uuid))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_all_routes(&self) -> StoreResult<Vec<route::Model>> {
        Ok(route::Entity::find().all(self.db.as_ref()).await?)
    }

    async fn list_routes_page(
        &self,
        brand_id: Option<&str>,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> StoreResult<RoutePage> {
        use sea_orm::sea_query::Expr;

        let mut base = route::Entity::find().order_by_desc(route::Column::CreatedAt);
        if let Some(brand_id) = brand_id.map(str::trim).filter(|s| !s.is_empty()) {
            // Parse to Uuid — see `parse_uuid` (TEXT param ≠ BLOB column on SQLite).
            let brand_uuid = super::parse_uuid(brand_id)?;
            base = base.filter(route::Column::BrandId.eq(brand_uuid));
        }
        if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
            let needle = q.to_lowercase();
            // Search the route name, both city slugs and the owning
            // brand's name (subquery keeps it one round-trip). LIKE with
            // a LOWER()-ed column is portable across SQLite + Postgres —
            // the same trick `apply_q` in the vehicle-type store uses.
            base = base.filter(
                sea_orm::Condition::any()
                    .add(Expr::cust_with_values(
                        "LOWER(name) LIKE '%' || ? || '%'",
                        [needle.clone()],
                    ))
                    .add(Expr::cust_with_values(
                        "LOWER(start_location_id) LIKE '%' || ? || '%'",
                        [needle.clone()],
                    ))
                    .add(Expr::cust_with_values(
                        "LOWER(end_location_id) LIKE '%' || ? || '%'",
                        [needle.clone()],
                    ))
                    .add(Expr::cust_with_values(
                        "brand_id IN (SELECT id FROM brand WHERE LOWER(name) LIKE '%' || ? || '%')",
                        [needle],
                    )),
            );
        }

        let total = base.clone().count(self.db.as_ref()).await?;
        let mut query = base.offset(offset);
        if let Some(limit) = limit {
            query = query.limit(limit);
        }
        let items = query.all(self.db.as_ref()).await?;
        Ok(RoutePage { items, total })
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
        let brand_uuid = super::parse_uuid(brand_id)?;
        Ok(route::Entity::find()
            .filter(route::Column::BrandId.eq(brand_uuid))
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
        // GROUP BY key decodes as `Uuid` (BLOB on SQLite — see `parse_uuid`).
        use sea_orm::sea_query::Expr;
        let brand_uuids: Vec<Uuid> = brand_ids
            .iter()
            .map(|id| super::parse_uuid(id))
            .collect::<StoreResult<Vec<_>>>()?;
        let rows: Vec<(Uuid, i64)> = route::Entity::find()
            .filter(route::Column::BrandId.is_in(brand_uuids))
            .select_only()
            .column(route::Column::BrandId)
            .column_as(Expr::col(route::Column::Id).count(), "count")
            .group_by(route::Column::BrandId)
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

    // ── PickupPoint ─────────────────────────────────────────────

    async fn list_pickup_points_by_route(
        &self,
        route_id: &str,
    ) -> StoreResult<Vec<pickup_point::Model>> {
        // Parse to Uuid — see `parse_uuid` (TEXT param ≠ BLOB column on SQLite).
        let route_uuid = super::parse_uuid(route_id)?;
        Ok(pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.eq(route_uuid))
            .order_by_asc(pickup_point::Column::StopOrder)
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_pickup_points_by_route(&self, route_id: &str) -> StoreResult<usize> {
        // Same fix as count_routes_by_brand — `count()` instead of `all().len()`.
        let route_uuid = super::parse_uuid(route_id)?;
        Ok(pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.eq(route_uuid))
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
        // GROUP BY key decodes as `Uuid` (BLOB on SQLite — see `parse_uuid`).
        let route_uuids: Vec<Uuid> = route_ids
            .iter()
            .map(|id| super::parse_uuid(id))
            .collect::<StoreResult<Vec<_>>>()?;
        let rows: Vec<(Uuid, i64)> = pickup_point::Entity::find()
            .filter(pickup_point::Column::RouteId.is_in(route_uuids))
            .select_only()
            .column(pickup_point::Column::RouteId)
            .column_as(Expr::col(pickup_point::Column::Id).count(), "count")
            .group_by(pickup_point::Column::RouteId)
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

    /// Find pickup points within two bounding boxes (pickup area + drop area).
    /// Returns all pickup_points that fall within EITHER box, joined with
    /// their parent route. The caller then:
    /// 1. Computes haversine distance from each point to the user's desired
    ///    pickup/drop coordinates.
    /// 2. Groups by route_id.
    /// 3. For each route, finds the closest "pickup" point (near `from`)
    ///    and the closest "drop" point (near `to`).
    /// 4. Checks direction: pickup.stop_order < drop.stop_order.
    /// 5. Sorts by combined distance + returns paginated results.
    ///
    /// Uses raw SQL via `FromQueryResult` — the same pattern as
    /// `count_channels_by_status` in `src/store/chat.rs`.
    #[allow(clippy::too_many_arguments)]
    async fn find_pickup_points_in_bbox(
        &self,
        from_lat_min: f64,
        from_lat_max: f64,
        from_lon_min: f64,
        from_lon_max: f64,
        to_lat_min: f64,
        to_lat_max: f64,
        to_lon_min: f64,
        to_lon_max: f64,
    ) -> StoreResult<Vec<PickupPointWithRoute>> {
        use sea_orm::FromQueryResult;
        use sea_orm::Value;

        #[derive(FromQueryResult)]
        struct Row {
            id: Uuid,
            route_id: Uuid,
            route_name: String,
            brand_id: Option<Uuid>,
            lat: Option<f64>,
            lon: Option<f64>,
            stop_order: i64,
            kind: Option<String>,
            name: Option<String>,
            route_status: String,
        }

        // Single query with OR between two bounding boxes. This fetches
        // all pickup_points that could be either a pickup candidate or a
        // drop candidate for the user's desired locations.
        //
        // We also JOIN with the route table to get route_name + brand_id +
        // route_status in a single round-trip, and filter to active routes
        // only (inactive routes don't have trips).
        let sql = r#"SELECT
            pp.id,
            pp.route_id,
            r.name as route_name,
            r.brand_id,
            pp.lat,
            pp.lon,
            pp.stop_order,
            pp.kind,
            pp.name,
            r.status as route_status
        FROM pickup_point pp
        INNER JOIN route r ON pp.route_id = r.id
        WHERE r.status = 'active'
          AND pp.lat IS NOT NULL
          AND pp.lon IS NOT NULL
          AND (
            (pp.lat BETWEEN ? AND ? AND pp.lon BETWEEN ? AND ?)
            OR
            (pp.lat BETWEEN ? AND ? AND pp.lon BETWEEN ? AND ?)
          )"#;

        let values: Vec<Value> = vec![
            from_lat_min.into(),
            from_lat_max.into(),
            from_lon_min.into(),
            from_lon_max.into(),
            to_lat_min.into(),
            to_lat_max.into(),
            to_lon_min.into(),
            to_lon_max.into(),
        ];

        let stmt =
            Statement::from_sql_and_values(self.db.as_ref().get_database_backend(), sql, values);

        let rows = Row::find_by_statement(stmt).all(self.db.as_ref()).await?;

        Ok(rows
            .into_iter()
            .map(|r| PickupPointWithRoute {
                pickup_id: r.id,
                route_id: r.route_id,
                route_name: r.route_name,
                brand_id: r.brand_id,
                lat: r.lat,
                lon: r.lon,
                stop_order: r.stop_order,
                kind: r.kind,
                name: r.name,
                route_status: r.route_status,
            })
            .collect())
    }
}
