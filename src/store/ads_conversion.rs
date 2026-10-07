//! Ad-conversion store — read/write access to the `ad_conversion` table
//! (first-party, server-side Google Ads conversion records).
//!
//! Follows the template's store pattern: `AdConversionStore` trait +
//! `DbAdConversionStore` (`#[retry]`). The unique index on
//! `(event, transaction_id)` is the dedupe boundary — the same booking
//! beamed twice (browser retry, gtag + beacon double-fire) stores once.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::ad_conversion;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

/// A conversion to persist — everything the Google Ads API uploader
/// needs on a later pass (the click ids ARE the attribution join key).
#[derive(Debug, Clone)]
pub struct NewAdConversion {
    pub event: String,
    pub transaction_id: String,
    /// Revenue as the client's decimal string ("250000" / "250000.00")
    /// — kept verbatim so no float rounding ever reaches Google.
    pub conversion_value: Option<String>,
    pub currency: Option<String>,
    pub gclid: Option<String>,
    pub wbraid: Option<String>,
    pub gbraid: Option<String>,
}

#[async_trait]
pub trait AdConversionStore: Send + Sync {
    /// Insert a conversion. Returns `(model, inserted)` — `false` means
    /// the `(event, transaction_id)` pair already exists (dedupe), and
    /// the EXISTING row is returned untouched.
    async fn insert_deduped(
        &self,
        conversion: NewAdConversion,
    ) -> StoreResult<(ad_conversion::Model, bool)>;

    /// Rows still awaiting a successful Google Ads API upload, oldest
    /// first (backfill order). `limit` bounds the sweep batch.
    async fn list_unfinished(&self, limit: u64) -> StoreResult<Vec<ad_conversion::Model>>;

    /// Set a row's upload outcome: `uploaded` stamps `uploaded_at`;
    /// anything else (`error`, `unconfigured`) leaves it retryable.
    async fn mark_status(&self, id: Uuid, status: &str) -> StoreResult<()>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbAdConversionStore {
    db: Arc<DatabaseConnection>,
}

impl DbAdConversionStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbAdConversionStore {}

#[async_trait]
#[retry]
impl AdConversionStore for DbAdConversionStore {
    async fn insert_deduped(
        &self,
        c: NewAdConversion,
    ) -> StoreResult<(ad_conversion::Model, bool)> {
        if c.event.trim().is_empty() || c.event.len() > 32 {
            return Err(StoreError::Validation("invalid conversion event".into()));
        }
        if c.transaction_id.trim().is_empty() || c.transaction_id.len() > 128 {
            return Err(StoreError::Validation("invalid transaction id".into()));
        }

        // Dedupe read first (mirrors the push-device upsert); a racing
        // double-insert falls into the unique-violation branch below.
        let existing = ad_conversion::Entity::find()
            .filter(ad_conversion::Column::Event.eq(&c.event))
            .filter(ad_conversion::Column::TransactionId.eq(&c.transaction_id))
            .one(self.db.as_ref())
            .await?;
        if let Some(m) = existing {
            return Ok((m, false));
        }

        let now = chrono::Utc::now().to_rfc3339();
        let am = ad_conversion::ActiveModel {
            id: Set(Uuid::new_v4()),
            event: Set(c.event.clone()),
            transaction_id: Set(c.transaction_id.clone()),
            conversion_value: Set(c.conversion_value),
            currency: Set(c.currency),
            gclid: Set(c.gclid),
            wbraid: Set(c.wbraid),
            gbraid: Set(c.gbraid),
            status: Set("pending".to_string()),
            created_at: Set(now),
            uploaded_at: Set(None),
        };
        match am.insert(self.db.as_ref()).await {
            Ok(m) => Ok((m, true)),
            Err(e) => {
                // Lost a race against the unique index → duplicate.
                if e.to_string().to_lowercase().contains("unique") {
                    let m = ad_conversion::Entity::find()
                        .filter(ad_conversion::Column::Event.eq(&c.event))
                        .filter(ad_conversion::Column::TransactionId.eq(&c.transaction_id))
                        .one(self.db.as_ref())
                        .await?
                        .ok_or_else(|| StoreError::Conflict("conversion race".into()))?;
                    Ok((m, false))
                } else {
                    Err(StoreError::from(e))
                }
            }
        }
    }

    async fn list_unfinished(&self, limit: u64) -> StoreResult<Vec<ad_conversion::Model>> {
        Ok(ad_conversion::Entity::find()
            .filter(ad_conversion::Column::Status.ne("uploaded"))
            .order_by_asc(ad_conversion::Column::CreatedAt)
            .limit(limit.clamp(1, 500))
            .all(self.db.as_ref())
            .await?)
    }

    async fn mark_status(&self, id: Uuid, status: &str) -> StoreResult<()> {
        let m = ad_conversion::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("conversion {id}")))?;
        let mut am = m.into_active_model();
        am.status = Set(status.to_string());
        if status == "uploaded" {
            am.uploaded_at = Set(Some(chrono::Utc::now().to_rfc3339()));
        }
        am.update(self.db.as_ref()).await?;
        Ok(())
    }
}
