//! Notification store — read/write access to the `notification` table.
//!
//! Follows the template's store pattern: `NotificationStore` trait +
//! `DbNotificationStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::notification;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

/// Parse a uuid string for a query filter BIND. SQLite stores Uuid
/// columns as 16-byte BLOBs — binding a TEXT value never matches, so
/// every uuid filter must bind the parsed `Uuid` (Postgres casts
/// text->uuid implicitly, SQLite does not).
fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid uuid: {s}")))
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait NotificationStore: Send + Sync {
    /// List notifications for a user, newest first.
    async fn list_by_user(
        &self,
        user_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<notification::Model>>;

    /// Count all notifications for a user (for the `total` field of the
    /// list envelope).
    async fn count_by_user(&self, user_id: &str) -> StoreResult<u64>;

    /// Count only unread notifications (for the badge counter).
    async fn count_unread(&self, user_id: &str) -> StoreResult<u64>;

    /// Insert a new notification row.
    async fn insert(&self, model: notification::ActiveModel) -> StoreResult<notification::Model>;

    /// Mark a single notification as read.
    async fn mark_read(&self, id: Uuid) -> StoreResult<Option<notification::Model>>;

    /// Mark all of a user's notifications as read. Returns the number
    /// of rows updated.
    async fn mark_all_read(&self, user_id: &str) -> StoreResult<u64>;

    /// Mark a specific set of notification ids as read. Returns the
    /// number of rows updated.
    async fn mark_many_read(&self, user_id: &str, ids: &[Uuid]) -> StoreResult<u64>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbNotificationStore {
    db: Arc<DatabaseConnection>,
}

impl DbNotificationStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbNotificationStore {}

#[async_trait]
#[retry]
impl NotificationStore for DbNotificationStore {
    async fn list_by_user(
        &self,
        user_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<notification::Model>> {
        Ok(notification::Entity::find()
            .filter(notification::Column::UserId.eq(parse_uuid(user_id)?))
            .order_by_desc(notification::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_by_user(&self, user_id: &str) -> StoreResult<u64> {
        Ok(notification::Entity::find()
            .filter(notification::Column::UserId.eq(parse_uuid(user_id)?))
            .count(self.db.as_ref())
            .await?)
    }

    async fn count_unread(&self, user_id: &str) -> StoreResult<u64> {
        Ok(notification::Entity::find()
            .filter(notification::Column::UserId.eq(parse_uuid(user_id)?))
            .filter(notification::Column::Read.eq(false))
            .count(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert(&self, model: notification::ActiveModel) -> StoreResult<notification::Model> {
        Ok(model.insert(self.db.as_ref()).await?)
    }

    async fn mark_read(&self, id: Uuid) -> StoreResult<Option<notification::Model>> {
        let existing = notification::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?;
        if let Some(m) = existing {
            // Only update if not already read — saves a write.
            if !m.read {
                let mut active: notification::ActiveModel = m.into();
                active.read = Set(true);
                return Ok(active.update(self.db.as_ref()).await.map(Some)?);
            }
            // Already read — return the existing model.
            // Re-fetch to return a fresh copy.
            return Ok(notification::Entity::find_by_id(id)
                .one(self.db.as_ref())
                .await?);
        }
        Ok(None)
    }

    async fn mark_all_read(&self, user_id: &str) -> StoreResult<u64> {
        // Single bulk UPDATE — replaces the previous load-all-then-loop
        // pattern that issued N UPDATEs (one per unread notification) and
        // silently swallowed errors via `let _ =`. The previous version
        // could leave some notifications unread but report success.
        let res = notification::Entity::update_many()
            .col_expr(notification::Column::Read, Expr::value(true))
            .filter(notification::Column::UserId.eq(parse_uuid(user_id)?))
            .filter(notification::Column::Read.eq(false))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    async fn mark_many_read(&self, user_id: &str, ids: &[Uuid]) -> StoreResult<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        // Single bulk UPDATE constrained by both user_id (defence-in-depth
        // against IDOR — caller can't mark other users' notifications) and
        // the requested id set. Replaces the previous load-then-loop.
        let res = notification::Entity::update_many()
            .col_expr(notification::Column::Read, Expr::value(true))
            .filter(notification::Column::UserId.eq(parse_uuid(user_id)?))
            .filter(notification::Column::Id.is_in(ids.to_vec()))
            .filter(notification::Column::Read.eq(false))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }
}
