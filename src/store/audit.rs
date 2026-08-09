//! Audit store — write access to the `audit_log` table.
//!
//! Follows the template's store pattern: `AuditStore` trait +
//! `DbAuditStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{DatabaseConnection, EntityTrait};
use store_macros::retry;

use crate::entity::audit_log;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait AuditStore: Send + Sync {
    async fn insert_audit_log(&self, model: audit_log::ActiveModel) -> StoreResult<()>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbAuditStore {
    db: Arc<DatabaseConnection>,
}

impl DbAuditStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbAuditStore {}

#[async_trait]
#[retry]
impl AuditStore for DbAuditStore {
    #[store_macros::no_retry]
    async fn insert_audit_log(&self, model: audit_log::ActiveModel) -> StoreResult<()> {
        audit_log::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }
}
