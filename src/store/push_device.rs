//! Push-device store — read/write access to the `push_device` table
//! (FCM/APNs registration tokens per user).
//!
//! Follows the template's store pattern: `PushDeviceStore` trait +
//! `DbPushDeviceStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::push_device;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

/// Parse a uuid string for a query filter BIND. The rust-sql engine
/// (sqlite dialect) stores Uuid columns as 16-byte BLOBs — binding a
/// TEXT value never matches, so every uuid filter must bind the parsed
/// `Uuid` (a BLOB parameter that does).
fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid uuid: {s}")))
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait PushDeviceStore: Send + Sync {
    /// Register (or re-register) a device token for a user. Upserts on
    /// (user_id, token) — a known token only refreshes
    /// `updated_at`/`platform`. Returns the persisted model.
    async fn upsert(
        &self,
        user_id: &str,
        token: &str,
        platform: &str,
    ) -> StoreResult<push_device::Model>;

    /// All device tokens registered by a user (any platform).
    async fn list_by_user(&self, user_id: &str) -> StoreResult<Vec<push_device::Model>>;

    /// Remove one token (client logout / token rotation). Returns the
    /// number of rows deleted.
    async fn delete_by_token(&self, token: &str) -> StoreResult<u64>;

    /// Remove every device row a user owns (account-level logout).
    /// Returns the number of rows deleted.
    async fn delete_by_user(&self, user_id: &str) -> StoreResult<u64>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbPushDeviceStore {
    db: Arc<DatabaseConnection>,
}

impl DbPushDeviceStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbPushDeviceStore {}

#[async_trait]
#[retry]
impl PushDeviceStore for DbPushDeviceStore {
    async fn upsert(
        &self,
        user_id: &str,
        token: &str,
        platform: &str,
    ) -> StoreResult<push_device::Model> {
        if token.trim().is_empty() || token.len() > 4096 {
            return Err(StoreError::Validation("invalid push token".into()));
        }
        let uid = parse_uuid(user_id)?;
        let now = chrono::Utc::now().to_rfc3339();

        // Insert-or-refresh. The (user_id, token) UNIQUE index makes a
        // racing double-register fall into the update branch below.
        let existing = push_device::Entity::find()
            .filter(push_device::Column::UserId.eq(uid))
            .filter(push_device::Column::Token.eq(token))
            .one(self.db.as_ref())
            .await?;

        let model = if let Some(m) = existing {
            let mut am = m.into_active_model();
            am.platform = Set(Some(platform.to_string()));
            am.updated_at = Set(Some(now));
            am.update(self.db.as_ref()).await?
        } else {
            let am = push_device::ActiveModel {
                id: Set(Uuid::new_v4()),
                user_id: Set(uid),
                token: Set(token.to_string()),
                platform: Set(Some(platform.to_string())),
                created_at: Set(now),
                updated_at: Set(None),
                last_seen_at: Set(None),
            };
            am.insert(self.db.as_ref()).await?
        };
        Ok(model)
    }

    async fn list_by_user(&self, user_id: &str) -> StoreResult<Vec<push_device::Model>> {
        Ok(push_device::Entity::find()
            .filter(push_device::Column::UserId.eq(parse_uuid(user_id)?))
            .filter(Expr::col((push_device::Entity, push_device::Column::Token)).ne(""))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn delete_by_token(&self, token: &str) -> StoreResult<u64> {
        let res = push_device::Entity::delete_many()
            .filter(push_device::Column::Token.eq(token))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    async fn delete_by_user(&self, user_id: &str) -> StoreResult<u64> {
        let res = push_device::Entity::delete_many()
            .filter(push_device::Column::UserId.eq(parse_uuid(user_id)?))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }
}
