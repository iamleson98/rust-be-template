//! Price alert store — read/write access to the `price_alert` table.
//!
//! Follows the template's store pattern: `PriceAlertStore` trait +
//! `DbPriceAlertStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::price_alert;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait PriceAlertStore: Send + Sync {
    async fn find_price_alert_by_id(&self, id: Uuid) -> StoreResult<Option<price_alert::Model>>;

    /// List alerts for a given owner (authenticated user id), optionally
    /// filtered by status. Defaults to `"active"` when `status` is `None`.
    async fn list_alerts_by_user(
        &self,
        user_id: &str,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<price_alert::Model>>;

    /// List alerts for a phone number (guest lookup), optionally filtered
    /// by status. Defaults to `"active"` when `status` is `None`.
    async fn list_alerts_by_phone(
        &self,
        phone: &str,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<price_alert::Model>>;

    /// Count alerts matching the owner/phone + status filter. Used to
    /// populate the `total` field of the list envelope without loading
    /// all rows.
    async fn count_alerts(
        &self,
        user_id: Option<&str>,
        phone: Option<&str>,
        status: Option<&str>,
    ) -> StoreResult<u64>;

    async fn find_duplicate_alert(
        &self,
        user_id: Option<&str>,
        phone: &str,
        route_id: Option<&str>,
        target_price: i64,
    ) -> StoreResult<Option<price_alert::Model>>;
    async fn insert_price_alert(
        &self,
        model: price_alert::ActiveModel,
    ) -> StoreResult<price_alert::Model>;
    async fn update_price_alert(
        &self,
        model: price_alert::ActiveModel,
    ) -> StoreResult<price_alert::Model>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbPriceAlertStore {
    db: Arc<DatabaseConnection>,
}

impl DbPriceAlertStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbPriceAlertStore {}

#[async_trait]
#[retry]
impl PriceAlertStore for DbPriceAlertStore {
    async fn find_price_alert_by_id(&self, id: Uuid) -> StoreResult<Option<price_alert::Model>> {
        Ok(price_alert::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_alerts_by_user(
        &self,
        user_id: &str,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<price_alert::Model>> {
        let mut q =
            price_alert::Entity::find().filter(price_alert::Column::UserId.eq(user_id.to_string()));
        if let Some(s) = status {
            q = q.filter(price_alert::Column::Status.eq(s.to_string()));
        }
        Ok(q.order_by_desc(price_alert::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_alerts_by_phone(
        &self,
        phone: &str,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<price_alert::Model>> {
        let mut q =
            price_alert::Entity::find().filter(price_alert::Column::Phone.eq(phone.to_string()));
        if let Some(s) = status {
            q = q.filter(price_alert::Column::Status.eq(s.to_string()));
        }
        Ok(q.order_by_desc(price_alert::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_alerts(
        &self,
        user_id: Option<&str>,
        phone: Option<&str>,
        status: Option<&str>,
    ) -> StoreResult<u64> {
        let mut q = price_alert::Entity::find();
        if let Some(uid) = user_id {
            q = q.filter(price_alert::Column::UserId.eq(uid.to_string()));
        }
        if let Some(p) = phone {
            q = q.filter(price_alert::Column::Phone.eq(p.to_string()));
        }
        if let Some(s) = status {
            q = q.filter(price_alert::Column::Status.eq(s.to_string()));
        }
        Ok(q.count(self.db.as_ref()).await?)
    }

    async fn find_duplicate_alert(
        &self,
        user_id: Option<&str>,
        phone: &str,
        route_id: Option<&str>,
        target_price: i64,
    ) -> StoreResult<Option<price_alert::Model>> {
        // Build the duplicate-detection query.
        //
        // NULL-safe: when `route_id` is `None`, we match rows whose
        // `route_id` IS NULL (SQL `=` never matches NULL). This is the
        // correct dedup semantics — "same route" means both have a route
        // and it matches, OR both have no route.
        let mut q = price_alert::Entity::find()
            .filter(price_alert::Column::TargetPrice.eq(Some(target_price as i32)))
            .filter(price_alert::Column::Status.eq("active"));
        match route_id {
            Some(rid) => {
                q = q.filter(price_alert::Column::RouteId.eq(rid.to_string()));
            }
            None => {
                q = q.filter(price_alert::Column::RouteId.is_null());
            }
        }
        match user_id {
            Some(uid) => {
                q = q.filter(price_alert::Column::UserId.eq(uid.to_string()));
            }
            None => {
                q = q
                    .filter(price_alert::Column::Phone.eq(phone.to_string()))
                    .filter(price_alert::Column::UserId.is_null());
            }
        }
        Ok(q.one(self.db.as_ref()).await?)
    }

    #[store_macros::no_retry]
    async fn insert_price_alert(
        &self,
        model: price_alert::ActiveModel,
    ) -> StoreResult<price_alert::Model> {
        Ok(model.insert(self.db.as_ref()).await?)
    }

    async fn update_price_alert(
        &self,
        model: price_alert::ActiveModel,
    ) -> StoreResult<price_alert::Model> {
        Ok(model.update(self.db.as_ref()).await?)
    }
}
