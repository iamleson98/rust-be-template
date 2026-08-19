//! Payment store — read/write access to the `payment` table.
//!
//! Follows the template's store pattern: `PaymentStore` trait +
//! `DbPaymentStore` (`#[retry]`). Like the booking store, this layer is
//! intentionally thin — the payment service orchestrates provider calls,
//! signature verification, and the booking-state-machine side effects.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::payment;
use crate::payment::statuses;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait PaymentStore: Send + Sync {
    async fn find_by_id(&self, id: Uuid) -> StoreResult<Option<payment::Model>>;
    async fn find_by_txn_ref(&self, txn_ref: &str) -> StoreResult<Option<payment::Model>>;
    async fn list_by_booking(&self, booking_id: &str) -> StoreResult<Vec<payment::Model>>;
    async fn find_active_for_booking(
        &self,
        booking_id: &str,
    ) -> StoreResult<Option<payment::Model>>;

    /// Insert a new payment row.
    async fn insert(&self, model: payment::ActiveModel) -> StoreResult<()>;

    /// Update an existing payment row. Replaces all updatable columns.
    async fn update(&self, model: payment::ActiveModel) -> StoreResult<payment::Model>;

    /// Admin: paginated list with optional status / provider filter.
    /// Ordered by `created_at DESC`.
    async fn list_admin(
        &self,
        status: Option<&str>,
        provider: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<payment::Model>>;

    /// Admin: count rows matching the same filters as `list_admin`.
    /// Uses `COUNT(*)` — does NOT load rows into memory.
    async fn count_admin(&self, status: Option<&str>, provider: Option<&str>) -> StoreResult<u64>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbPaymentStore {
    db: Arc<DatabaseConnection>,
}

impl DbPaymentStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbPaymentStore {}

#[async_trait]
#[retry]
impl PaymentStore for DbPaymentStore {
    async fn find_by_id(&self, id: Uuid) -> StoreResult<Option<payment::Model>> {
        Ok(payment::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_by_txn_ref(&self, txn_ref: &str) -> StoreResult<Option<payment::Model>> {
        Ok(payment::Entity::find()
            .filter(payment::Column::ProviderTxnRef.eq(txn_ref))
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_by_booking(&self, booking_id: &str) -> StoreResult<Vec<payment::Model>> {
        Ok(payment::Entity::find()
            .filter(payment::Column::BookingId.eq(booking_id))
            .order_by(payment::Column::CreatedAt, Order::Desc)
            .all(self.db.as_ref())
            .await?)
    }

    async fn find_active_for_booking(
        &self,
        booking_id: &str,
    ) -> StoreResult<Option<payment::Model>> {
        // A booking has at most one "active" payment — the most recent one
        // whose status is `pending`. Older pending rows are cancelled
        // atomically when a new payment is created (see PaymentService::create).
        Ok(payment::Entity::find()
            .filter(payment::Column::BookingId.eq(booking_id))
            .filter(payment::Column::Status.eq(statuses::PENDING))
            .order_by(payment::Column::CreatedAt, Order::Desc)
            .limit(1)
            .one(self.db.as_ref())
            .await?)
    }

    async fn insert(&self, model: payment::ActiveModel) -> StoreResult<()> {
        payment::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update(&self, model: payment::ActiveModel) -> StoreResult<payment::Model> {
        Ok(payment::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn list_admin(
        &self,
        status: Option<&str>,
        provider: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<payment::Model>> {
        let mut q = payment::Entity::find();
        if let Some(s) = status {
            q = q.filter(payment::Column::Status.eq(s));
        }
        if let Some(p) = provider {
            q = q.filter(payment::Column::Provider.eq(p));
        }
        Ok(q.order_by(payment::Column::CreatedAt, Order::Desc)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_admin(&self, status: Option<&str>, provider: Option<&str>) -> StoreResult<u64> {
        let mut q = payment::Entity::find();
        if let Some(s) = status {
            q = q.filter(payment::Column::Status.eq(s));
        }
        if let Some(p) = provider {
            q = q.filter(payment::Column::Provider.eq(p));
        }
        Ok(q.count(self.db.as_ref()).await?)
    }
}
