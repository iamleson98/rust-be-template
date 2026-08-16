//! Notification store — read/write access to the `notification` table.
//!
//! Follows the template's store pattern: `NotificationStore` trait +
//! `DbNotificationStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::notification;

use super::error::StoreResult;
use super::retry::RetryPolicy;

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
            .filter(notification::Column::UserId.eq(user_id.to_string()))
            .order_by_desc(notification::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_by_user(&self, user_id: &str) -> StoreResult<u64> {
        Ok(notification::Entity::find()
            .filter(notification::Column::UserId.eq(user_id.to_string()))
            .count(self.db.as_ref())
            .await?)
    }

    async fn count_unread(&self, user_id: &str) -> StoreResult<u64> {
        Ok(notification::Entity::find()
            .filter(notification::Column::UserId.eq(user_id.to_string()))
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
        // SeaORM doesn't have a direct UPDATE...WHERE API without raw
        // SQL; the simplest portable approach is to load unread rows
        // and update each one. For a typical user this is <100 rows.
        let unread = notification::Entity::find()
            .filter(notification::Column::UserId.eq(user_id.to_string()))
            .filter(notification::Column::Read.eq(false))
            .all(self.db.as_ref())
            .await?;
        let n = unread.len() as u64;
        for m in unread {
            let mut active: notification::ActiveModel = m.into();
            active.read = Set(true);
            let _ = active.update(self.db.as_ref()).await;
        }
        Ok(n)
    }

    async fn mark_many_read(&self, user_id: &str, ids: &[Uuid]) -> StoreResult<u64> {
        if ids.is_empty() {
            return Ok(0);
        }
        let rows = notification::Entity::find()
            .filter(notification::Column::UserId.eq(user_id.to_string()))
            .filter(notification::Column::Id.is_in(ids.to_vec()))
            .filter(notification::Column::Read.eq(false))
            .all(self.db.as_ref())
            .await?;
        let n = rows.len() as u64;
        for m in rows {
            let mut active: notification::ActiveModel = m.into();
            active.read = Set(true);
            let _ = active.update(self.db.as_ref()).await;
        }
        Ok(n)
    }
}
