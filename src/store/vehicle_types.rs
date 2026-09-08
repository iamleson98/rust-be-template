//! Vehicle-type store — read/write access to the `vehicle_type` catalog.
//!
//! Follows the template's store pattern: `VehicleTypeStore` trait +
//! `DbVehicleTypeStore` (`#[retry]`). The list supports the
//! search/pagination shape the infinite-scroll select on the frontend
//! consumes (`q` + `limit`/`offset` + total count).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::vehicle_type;

use super::error::StoreResult;
use super::retry::RetryPolicy;

/// One page of the paginated vehicle-type list.
pub struct VehicleTypePage {
    pub items: Vec<vehicle_type::Model>,
    /// Total rows matching the filter (ignores limit/offset).
    pub total: u64,
}

#[async_trait]
pub trait VehicleTypeStore: Send + Sync {
    async fn find_vehicle_type_by_id(&self, id: Uuid) -> StoreResult<Option<vehicle_type::Model>>;
    /// Case-insensitive code lookup (slug identity + duplicate guard).
    async fn find_vehicle_type_by_code(
        &self,
        code: &str,
    ) -> StoreResult<Option<vehicle_type::Model>>;
    /// Batched lookup by ids (public trip search resolves schedules'
    /// vehicle types in one query).
    async fn find_vehicle_types_by_ids(
        &self,
        ids: Vec<Uuid>,
    ) -> StoreResult<Vec<vehicle_type::Model>>;
    /// All active types ordered by `sort_order` then `label` (small
    /// catalog — the schedule form's picker).
    async fn list_active_vehicle_types(&self) -> StoreResult<Vec<vehicle_type::Model>>;
    /// Paginated list with an optional name/code filter. `q` matches
    /// label or code (case-insensitive, portable LIKE). `limit=None`
    /// returns every row (legacy "fetch all" consumers).
    async fn list_vehicle_types(
        &self,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> StoreResult<VehicleTypePage>;
    #[store_macros::no_retry]
    async fn insert_vehicle_type(&self, model: vehicle_type::ActiveModel) -> StoreResult<()>;
    async fn update_vehicle_type(
        &self,
        model: vehicle_type::ActiveModel,
    ) -> StoreResult<vehicle_type::Model>;
    async fn delete_vehicle_type(&self, id: Uuid) -> StoreResult<()>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbVehicleTypeStore {
    db: Arc<DatabaseConnection>,
}

impl DbVehicleTypeStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbVehicleTypeStore {}

/// Portable case-insensitive filter across label + code. `LIKE` with a
/// lower-cased column (`LOWER(x) LIKE …`) works on both SQLite and
/// the engine — the same trick `RouteStore::search_active_routes_by_name`
/// uses.
fn apply_q(
    mut query: sea_orm::Select<vehicle_type::Entity>,
    q: Option<&str>,
) -> sea_orm::Select<vehicle_type::Entity> {
    use sea_orm::sea_query::Expr;
    if let Some(q) = q.map(str::trim).filter(|s| !s.is_empty()) {
        let needle = q.to_lowercase();
        query = query.filter(
            sea_orm::Condition::any()
                .add(Expr::cust_with_values(
                    "LOWER(label) LIKE '%' || ? || '%'",
                    [needle.clone()],
                ))
                .add(Expr::cust_with_values(
                    "LOWER(code) LIKE '%' || ? || '%'",
                    [needle],
                )),
        );
    }
    query
}

#[async_trait]
#[retry]
impl VehicleTypeStore for DbVehicleTypeStore {
    async fn find_vehicle_type_by_id(&self, id: Uuid) -> StoreResult<Option<vehicle_type::Model>> {
        Ok(vehicle_type::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_vehicle_type_by_code(
        &self,
        code: &str,
    ) -> StoreResult<Option<vehicle_type::Model>> {
        use sea_orm::sea_query::Expr;
        // LOWER(code) = ? — portable case-insensitive equality.
        Ok(vehicle_type::Entity::find()
            .filter(Expr::cust_with_values(
                "LOWER(code) = ?",
                [code.trim().to_lowercase()],
            ))
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_vehicle_types_by_ids(
        &self,
        ids: Vec<Uuid>,
    ) -> StoreResult<Vec<vehicle_type::Model>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(vehicle_type::Entity::find()
            .filter(vehicle_type::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_active_vehicle_types(&self) -> StoreResult<Vec<vehicle_type::Model>> {
        Ok(vehicle_type::Entity::find()
            .filter(vehicle_type::Column::Status.eq("active"))
            .order_by_asc(vehicle_type::Column::SortOrder)
            .order_by_asc(vehicle_type::Column::Label)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_vehicle_types(
        &self,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> StoreResult<VehicleTypePage> {
        let base = apply_q(
            vehicle_type::Entity::find().order_by_asc(vehicle_type::Column::SortOrder),
            q,
        );
        let total = base.clone().count(self.db.as_ref()).await?;
        // SQLite requires LIMIT before OFFSET. "No limit" (limit = None)
        // with a non-zero offset is encoded as the maximum page size;
        // a zero offset skips OFFSET entirely.
        let mut query = base;
        match limit {
            Some(l) => query = query.limit(l).offset(offset),
            None if offset > 0 => query = query.limit(i64::MAX as u64).offset(offset),
            None => {}
        }
        let items = query.all(self.db.as_ref()).await?;
        Ok(VehicleTypePage { items, total })
    }

    async fn insert_vehicle_type(&self, model: vehicle_type::ActiveModel) -> StoreResult<()> {
        vehicle_type::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_vehicle_type(
        &self,
        model: vehicle_type::ActiveModel,
    ) -> StoreResult<vehicle_type::Model> {
        Ok(vehicle_type::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn delete_vehicle_type(&self, id: Uuid) -> StoreResult<()> {
        vehicle_type::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }
}
