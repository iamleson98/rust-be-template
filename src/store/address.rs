//! Address store — read/write access to the `address` and `schedule_point`
//! tables.
//!
//! Follows the template's store pattern: `AddressStore` trait +
//! `DbAddressStore` (`#[retry]`). No cache wrapper — address lists are
//! admin-scoped and low-traffic (same decision as `DbRouteStore` /
//! `DbScheduleStore`).
//!
//! Transactional point replacement (delete + re-insert for one schedule)
//! lives in `AdminService::set_schedule_points`, which uses the
//! `CompositeStore::db()` connection handle — see the note on
//! `CompositeStore::db`.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};

use store_macros::retry;
use uuid::Uuid;

use crate::entity::{address, schedule_point};

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait AddressStore: Send + Sync {
    // ── Address ─────────────────────────────────────────────────

    async fn find_address_by_id(&self, id: Uuid) -> StoreResult<Option<address::Model>>;
    async fn list_addresses_by_brand(&self, brand_id: &str) -> StoreResult<Vec<address::Model>>;
    /// Paginated + name-filtered list for a brand — the searchable,
    /// infinite-scroll schedule-point picker. Returns (page items, total
    /// matching rows). `limit=None` returns every matching row.
    async fn list_addresses_by_brand_page(
        &self,
        brand_id: &str,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> StoreResult<(Vec<address::Model>, u64)>;
    async fn list_addresses_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<address::Model>>;
    #[store_macros::no_retry]
    async fn insert_address(&self, model: address::ActiveModel) -> StoreResult<()>;
    async fn update_address(&self, model: address::ActiveModel) -> StoreResult<address::Model>;
    async fn delete_address(&self, id: Uuid) -> StoreResult<()>;
    async fn count_schedule_points_by_address(&self, address_id: Uuid) -> StoreResult<usize>;

    // ── Schedule points (reads; transactional writes live in the service) ──

    async fn list_points_by_schedule(
        &self,
        schedule_id: Uuid,
    ) -> StoreResult<Vec<schedule_point::Model>>;
    async fn list_points_by_schedules(
        &self,
        schedule_ids: Vec<Uuid>,
    ) -> StoreResult<Vec<schedule_point::Model>>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbAddressStore {
    db: Arc<DatabaseConnection>,
}

impl DbAddressStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbAddressStore {}

#[async_trait]
#[retry]
impl AddressStore for DbAddressStore {
    async fn find_address_by_id(&self, id: Uuid) -> StoreResult<Option<address::Model>> {
        Ok(address::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_addresses_by_brand(&self, brand_id: &str) -> StoreResult<Vec<address::Model>> {
        // Parse to Uuid — see `parse_uuid` for why the string form never
        // matches on SQLite (BLOB column vs TEXT parameter).
        let brand_uuid = super::parse_uuid(brand_id)?;
        Ok(address::Entity::find()
            .filter(address::Column::BrandId.eq(brand_uuid))
            .order_by_asc(address::Column::Name)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_addresses_by_brand_page(
        &self,
        brand_id: &str,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> StoreResult<(Vec<address::Model>, u64)> {
        use sea_orm::sea_query::Expr;
        // Parse to Uuid — see `parse_uuid` (a TEXT parameter never
        // matches the BLOB-stored uuid column on SQLite).
        let brand_uuid = super::parse_uuid(brand_id)?;
        // LOWER(name) LIKE — portable case-insensitive contains across
        // SQLite + Postgres (same trick as the route store).
        let needle = q
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| format!("%{}%", s.to_lowercase()));
        let base = address::Entity::find().filter(address::Column::BrandId.eq(brand_uuid));
        let base = match needle {
            Some(n) => base.filter(Expr::cust_with_values("LOWER(name) LIKE ?", [n])),
            None => base,
        };
        let total = base.clone().count(self.db.as_ref()).await?;
        // SQLite requires LIMIT before OFFSET. "No limit" (limit = None)
        // with a non-zero offset is encoded as the maximum page size;
        // a zero offset skips OFFSET entirely.
        let mut query = base.order_by_asc(address::Column::Name);
        match limit {
            Some(l) => query = query.limit(l).offset(offset),
            None if offset > 0 => query = query.limit(i64::MAX as u64).offset(offset),
            None => {}
        }
        let items = query.all(self.db.as_ref()).await?;
        Ok((items, total))
    }

    async fn list_addresses_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<address::Model>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(address::Entity::find()
            .filter(address::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_address(&self, model: address::ActiveModel) -> StoreResult<()> {
        address::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_address(&self, model: address::ActiveModel) -> StoreResult<address::Model> {
        Ok(address::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn delete_address(&self, id: Uuid) -> StoreResult<()> {
        address::Entity::delete_by_id(id)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn count_schedule_points_by_address(&self, address_id: Uuid) -> StoreResult<usize> {
        Ok(schedule_point::Entity::find()
            .filter(schedule_point::Column::AddressId.eq(address_id))
            .count(self.db.as_ref())
            .await? as usize)
    }

    async fn list_points_by_schedule(
        &self,
        schedule_id: Uuid,
    ) -> StoreResult<Vec<schedule_point::Model>> {
        Ok(schedule_point::Entity::find()
            .filter(schedule_point::Column::ScheduleId.eq(schedule_id))
            .order_by_asc(schedule_point::Column::StopOrder)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_points_by_schedules(
        &self,
        schedule_ids: Vec<Uuid>,
    ) -> StoreResult<Vec<schedule_point::Model>> {
        if schedule_ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(schedule_point::Entity::find()
            .filter(schedule_point::Column::ScheduleId.is_in(schedule_ids))
            .order_by_asc(schedule_point::Column::StopOrder)
            .all(self.db.as_ref())
            .await?)
    }
}
