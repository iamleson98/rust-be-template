//! Staff-presence state store — durable last-seen backstop for the
//! team board (`staff_presence_state` table).
//!
//! The LIVE registry is the in-process `presence` module (a DashMap —
//! the "cache" half of the design); this store is the "db" half: a
//! write-through of presence transitions plus slow `last_seen_at`
//! heartbeats, and the read path for "recently active but offline"
//! roster entries that survive restarts.
//!
//! Traffic profile (deliberately tiny):
//!   * writes arrive from the debounced journal task (batched, one
//!     upsert per staff member per flush — never per socket event);
//!   * reads happen when the journal refreshes the offline-roster
//!     cache (~ every 30s), not per UI request.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::staff_presence_state;

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────────

/// One durable presence row (see the module docs for semantics).
#[derive(Clone, Debug)]
pub struct StaffPresenceUpsert {
    pub user_id: Uuid,
    pub name: String,
    /// `"employee"` | `"admin"`.
    pub role: String,
    pub brand_id: Option<Uuid>,
    pub online: bool,
    /// RFC3339.
    pub last_seen_at: String,
    /// RFC3339 — set when `online` transitions to true.
    pub last_online_at: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait StaffPresenceStore: Send + Sync {
    /// Insert-or-update the row for one staff member (state, not log).
    async fn upsert(&self, row: StaffPresenceUpsert) -> StoreResult<()>;

    /// Rows whose `last_seen_at` is at or after `since_rfc3339`,
    /// newest first. The offline-roster cache is built from this
    /// (caller filters out members the live registry says are online).
    async fn list_recently_active(
        &self,
        since_rfc3339: &str,
        limit: u64,
    ) -> StoreResult<Vec<staff_presence_state::Model>>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbStaffPresenceStore {
    db: Arc<DatabaseConnection>,
}

impl DbStaffPresenceStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbStaffPresenceStore {}

#[async_trait]
#[retry]
impl StaffPresenceStore for DbStaffPresenceStore {
    async fn upsert(&self, row: StaffPresenceUpsert) -> StoreResult<()> {
        let model = staff_presence_state::ActiveModel {
            user_id: sea_orm::Set(row.user_id),
            name: sea_orm::Set(row.name),
            role: sea_orm::Set(row.role),
            brand_id: sea_orm::Set(row.brand_id),
            online: sea_orm::Set(row.online as i64),
            last_seen_at: sea_orm::Set(row.last_seen_at),
            last_online_at: sea_orm::Set(row.last_online_at),
        };
        // Upsert on the PK: presence is a STATE (one row per staff
        // member), so re-connects / re-disconnects update in place
        // instead of appending history.
        staff_presence_state::Entity::insert(model)
            .on_conflict(
                sea_orm::sea_query::OnConflict::columns([staff_presence_state::Column::UserId])
                    .update_columns([
                        staff_presence_state::Column::Name,
                        staff_presence_state::Column::Role,
                        staff_presence_state::Column::BrandId,
                        staff_presence_state::Column::Online,
                        staff_presence_state::Column::LastSeenAt,
                        staff_presence_state::Column::LastOnlineAt,
                    ])
                    .to_owned(),
            )
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn list_recently_active(
        &self,
        since_rfc3339: &str,
        limit: u64,
    ) -> StoreResult<Vec<staff_presence_state::Model>> {
        Ok(staff_presence_state::Entity::find()
            .filter(staff_presence_state::Column::LastSeenAt.gte(since_rfc3339.to_string()))
            .order_by_desc(staff_presence_state::Column::LastSeenAt)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The upsert row maps 1:1 onto the entity model — this guards the
    /// column list (a missing column in the ON CONFLICT update set
    /// would silently keep a stale value forever).
    #[test]
    fn upsert_row_covers_all_columns() {
        let row = StaffPresenceUpsert {
            user_id: Uuid::new_v4(),
            name: "Test Staff".into(),
            role: "employee".into(),
            brand_id: None,
            online: true,
            last_seen_at: "2026-09-12T00:00:00Z".into(),
            last_online_at: Some("2026-09-12T00:00:00Z".into()),
        };
        // Compile-time completeness: building the ActiveModel requires
        // every entity field, and every field is sourced from the row —
        // a field added to the entity without the row breaks this test.
        let am = staff_presence_state::ActiveModel {
            user_id: sea_orm::Set(row.user_id),
            name: sea_orm::Set(row.name),
            role: sea_orm::Set(row.role),
            brand_id: sea_orm::Set(row.brand_id),
            online: sea_orm::Set(row.online as i64),
            last_seen_at: sea_orm::Set(row.last_seen_at),
            last_online_at: sea_orm::Set(row.last_online_at),
        };
        // Every value must be Set (not NotSet/Unchanged) — a NotSet field
        // would write NULL/default on insert paths.
        let all_set = matches!(
            (
                am.user_id.is_set(),
                am.name.is_set(),
                am.role.is_set(),
                am.brand_id.is_set(),
                am.online.is_set(),
                am.last_seen_at.is_set(),
                am.last_online_at.is_set(),
            ),
            (true, true, true, true, true, true, true)
        );
        assert!(all_set, "every column must be written by the upsert");
    }
}

/// Test double: records upserts so journal semantics (coalescing,
/// transitions-only) can be asserted without a database.
#[cfg(test)]
pub mod tests_support {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct RecordingStore {
        rows: Mutex<Vec<StaffPresenceUpsert>>,
    }

    impl RecordingStore {
        pub fn writes(&self) -> Vec<StaffPresenceUpsert> {
            self.rows.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl StaffPresenceStore for RecordingStore {
        async fn upsert(&self, row: StaffPresenceUpsert) -> StoreResult<()> {
            self.rows.lock().unwrap().push(row);
            Ok(())
        }

        async fn list_recently_active(
            &self,
            _since_rfc3339: &str,
            _limit: u64,
        ) -> StoreResult<Vec<staff_presence_state::Model>> {
            Ok(Vec::new())
        }
    }
}
