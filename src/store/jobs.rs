//! Job store — read/write access to the `scheduled_job` + `job_run`
//! tables (the recurring-job scheduler's persistence).
//!
//! Follows the template's store pattern: `JobStore` trait +
//! `DbJobStore` (`#[retry]`). No cache wrapper — schedule rows are
//! admin-scoped and low-traffic (same decision as `DbAuditStore` /
//! `DbRouteStore`).
//!
//! Timestamps are ISO-8601 UTC strings with second precision and `Z`
//! suffix (`2026-09-02T15:04:05Z`) — fixed width, so lexicographic
//! comparison equals chronological comparison. `next_run_at <= now`
//! queries rely on this.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, SecondsFormat, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::dto::job::status;
use crate::entity::{job_run, scheduled_job};

use super::error::StoreResult;
use super::retry::RetryPolicy;

/// Current UTC time as a fixed-width ISO-8601 string (second precision,
/// `Z` suffix). See the module docs for why the exact shape matters.
pub(crate) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Parse one of the store's ISO-8601 strings back into a typed value.
pub(crate) fn parse_iso(s: &str) -> StoreResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| super::error::StoreError::Validation(format!("invalid timestamp {s:?}: {e}")))
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait JobStore: Send + Sync {
    // ── scheduled_job ──────────────────────────────────────────────

    async fn list_schedules(&self) -> StoreResult<Vec<scheduled_job::Model>>;
    async fn find_schedule(&self, job_type: &str) -> StoreResult<Option<scheduled_job::Model>>;
    /// Enabled schedules whose `next_run_at` is due (or past due).
    async fn find_due_schedules(&self, now: &str) -> StoreResult<Vec<scheduled_job::Model>>;
    #[store_macros::no_retry]
    async fn insert_schedule(&self, model: scheduled_job::ActiveModel) -> StoreResult<()>;
    async fn update_schedule(
        &self,
        model: scheduled_job::ActiveModel,
    ) -> StoreResult<scheduled_job::Model>;

    // ── job_run ────────────────────────────────────────────────────

    #[store_macros::no_retry]
    async fn insert_run(&self, model: job_run::ActiveModel) -> StoreResult<job_run::Model>;
    async fn update_run(&self, model: job_run::ActiveModel) -> StoreResult<job_run::Model>;
    /// Atomic `UPDATE job_run SET detail = ? WHERE id = ?` — used by
    /// progress writers. Unlike [`Self::update_run`] this cannot
    /// resurrect a stale status (no read-modify-write of the full row).
    async fn set_run_detail(&self, id: Uuid, detail: &str) -> StoreResult<()>;
    async fn find_run(&self, id: Uuid) -> StoreResult<Option<job_run::Model>>;
    /// Latest run of a job type, any status (for the admin "last run"
    /// column — also doubles as the live status of an in-flight run).
    async fn latest_run(&self, job_type: &str) -> StoreResult<Option<job_run::Model>>;
    /// The queued-or-running run of a job type, if any. Used to refuse
    /// stacking a second execution on top of one already in flight.
    async fn find_active_run(&self, job_type: &str) -> StoreResult<Option<job_run::Model>>;
    async fn list_runs(
        &self,
        job_type: Option<&str>,
        limit: u64,
    ) -> StoreResult<Vec<job_run::Model>>;
    /// Count of runs for a job type (used by the stats page / tests).
    async fn count_runs(&self, job_type: &str) -> StoreResult<u64>;

    // ── Maintenance (scheduler tick) ────────────────────────────────

    /// `UPDATE job_run SET status='failed' WHERE status IN (..) AND …`
    /// — sweeps runs that can no longer make progress (interrupted by a
    /// restart, or enqueued but never picked up). Returns the number of
    /// rows swept.
    async fn sweep_stale_runs(&self, statuses: &[&str], older_than: &str) -> StoreResult<u64>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbJobStore {
    db: Arc<DatabaseConnection>,
}

impl DbJobStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbJobStore {}

#[async_trait]
#[retry]
impl JobStore for DbJobStore {
    // ── scheduled_job ──────────────────────────────────────────────

    async fn list_schedules(&self) -> StoreResult<Vec<scheduled_job::Model>> {
        Ok(scheduled_job::Entity::find()
            .order_by_asc(scheduled_job::Column::JobType)
            .all(self.db.as_ref())
            .await?)
    }

    async fn find_schedule(&self, job_type: &str) -> StoreResult<Option<scheduled_job::Model>> {
        Ok(scheduled_job::Entity::find()
            .filter(scheduled_job::Column::JobType.eq(job_type))
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_due_schedules(&self, now: &str) -> StoreResult<Vec<scheduled_job::Model>> {
        Ok(scheduled_job::Entity::find()
            .filter(scheduled_job::Column::Enabled.eq(true))
            .filter(scheduled_job::Column::NextRunAt.is_not_null())
            .filter(scheduled_job::Column::NextRunAt.lte(now))
            .all(self.db.as_ref())
            .await?)
    }

    async fn insert_schedule(&self, model: scheduled_job::ActiveModel) -> StoreResult<()> {
        scheduled_job::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_schedule(
        &self,
        model: scheduled_job::ActiveModel,
    ) -> StoreResult<scheduled_job::Model> {
        let id = match &model.id {
            sea_orm::ActiveValue::Set(id) | sea_orm::ActiveValue::Unchanged(id) => *id,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires an id".to_string(),
                ));
            }
        };
        let enabled = match model.enabled {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires all fields".to_string(),
                ))
            }
        };
        let interval_days = match model.interval_days {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires all fields".to_string(),
                ))
            }
        };
        let at_hour = match model.at_hour {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires all fields".to_string(),
                ))
            }
        };
        let at_minute = match model.at_minute {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires all fields".to_string(),
                ))
            }
        };
        let next_run_at = match model.next_run_at {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires all fields".to_string(),
                ))
            }
        };
        let updated_at = match model.updated_at {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "scheduled job update requires all fields".to_string(),
                ))
            }
        };
        scheduled_job::Entity::update_many()
            .col_expr(
                scheduled_job::Column::Enabled,
                sea_orm::sea_query::Expr::value(enabled),
            )
            .col_expr(
                scheduled_job::Column::IntervalDays,
                sea_orm::sea_query::Expr::value(interval_days),
            )
            .col_expr(
                scheduled_job::Column::AtHour,
                sea_orm::sea_query::Expr::value(at_hour),
            )
            .col_expr(
                scheduled_job::Column::AtMinute,
                sea_orm::sea_query::Expr::value(at_minute),
            )
            .col_expr(
                scheduled_job::Column::NextRunAt,
                sea_orm::sea_query::Expr::value(next_run_at),
            )
            .col_expr(
                scheduled_job::Column::UpdatedAt,
                sea_orm::sea_query::Expr::value(updated_at),
            )
            .filter(scheduled_job::Column::Id.eq(id))
            .exec(self.db.as_ref())
            .await?;
        scheduled_job::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| {
                super::error::StoreError::Validation(
                    "scheduled job disappeared during update".to_string(),
                )
            })
    }

    // ── job_run ────────────────────────────────────────────────────

    async fn insert_run(&self, model: job_run::ActiveModel) -> StoreResult<job_run::Model> {
        Ok(model.insert(self.db.as_ref()).await?)
    }

    async fn update_run(&self, model: job_run::ActiveModel) -> StoreResult<job_run::Model> {
        let id = match &model.id {
            sea_orm::ActiveValue::Set(id) | sea_orm::ActiveValue::Unchanged(id) => *id,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "job run update requires an id".to_string(),
                ));
            }
        };
        let status = match model.status {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "job run update requires all fields".to_string(),
                ))
            }
        };
        let detail = match model.detail {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "job run update requires all fields".to_string(),
                ))
            }
        };
        let error = match model.error {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "job run update requires all fields".to_string(),
                ))
            }
        };
        let started_at = match model.started_at {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "job run update requires all fields".to_string(),
                ))
            }
        };
        let finished_at = match model.finished_at {
            sea_orm::ActiveValue::Set(value) | sea_orm::ActiveValue::Unchanged(value) => value,
            sea_orm::ActiveValue::NotSet => {
                return Err(super::error::StoreError::Validation(
                    "job run update requires all fields".to_string(),
                ))
            }
        };
        job_run::Entity::update_many()
            .col_expr(
                job_run::Column::Status,
                sea_orm::sea_query::Expr::value(status),
            )
            .col_expr(
                job_run::Column::Detail,
                sea_orm::sea_query::Expr::value(detail),
            )
            .col_expr(
                job_run::Column::Error,
                sea_orm::sea_query::Expr::value(error),
            )
            .col_expr(
                job_run::Column::StartedAt,
                sea_orm::sea_query::Expr::value(started_at),
            )
            .col_expr(
                job_run::Column::FinishedAt,
                sea_orm::sea_query::Expr::value(finished_at),
            )
            .filter(job_run::Column::Id.eq(id))
            .exec(self.db.as_ref())
            .await?;
        job_run::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| {
                super::error::StoreError::Validation(
                    "job run disappeared during update".to_string(),
                )
            })
    }

    async fn set_run_detail(&self, id: Uuid, detail: &str) -> StoreResult<()> {
        job_run::Entity::update_many()
            .col_expr(
                job_run::Column::Detail,
                sea_orm::sea_query::Expr::value(detail),
            )
            .filter(job_run::Column::Id.eq(id))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn find_run(&self, id: Uuid) -> StoreResult<Option<job_run::Model>> {
        Ok(job_run::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn latest_run(&self, job_type: &str) -> StoreResult<Option<job_run::Model>> {
        Ok(job_run::Entity::find()
            .filter(job_run::Column::JobType.eq(job_type))
            .order_by_desc(job_run::Column::CreatedAt)
            .order_by_desc(job_run::Column::Id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_active_run(&self, job_type: &str) -> StoreResult<Option<job_run::Model>> {
        Ok(job_run::Entity::find()
            .filter(job_run::Column::JobType.eq(job_type))
            .filter(job_run::Column::Status.is_in([status::QUEUED, status::RUNNING]))
            .order_by_desc(job_run::Column::CreatedAt)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_runs(
        &self,
        job_type: Option<&str>,
        limit: u64,
    ) -> StoreResult<Vec<job_run::Model>> {
        let mut q = job_run::Entity::find().order_by_desc(job_run::Column::CreatedAt);
        if let Some(t) = job_type {
            q = q.filter(job_run::Column::JobType.eq(t));
        }
        Ok(q.limit(limit).all(self.db.as_ref()).await?)
    }

    async fn count_runs(&self, job_type: &str) -> StoreResult<u64> {
        Ok(job_run::Entity::find()
            .filter(job_run::Column::JobType.eq(job_type))
            .count(self.db.as_ref())
            .await?)
    }

    // ── Maintenance ────────────────────────────────────────────────

    async fn sweep_stale_runs(&self, statuses: &[&str], older_than: &str) -> StoreResult<u64> {
        let older_than = parse_iso(older_than)?;
        Ok(job_run::Entity::update_many()
            .col_expr(
                job_run::Column::Status,
                sea_orm::sea_query::Expr::value("failed"),
            )
            .col_expr(
                job_run::Column::Error,
                sea_orm::sea_query::Expr::value(
                    "interrupted — no longer progressing (server restart or stale run)",
                ),
            )
            .col_expr(
                job_run::Column::FinishedAt,
                sea_orm::sea_query::Expr::value(now_iso()),
            )
            .filter(job_run::Column::Status.is_in(statuses.to_vec()))
            // Queued runs die on created_at; running runs die on started_at.
            // Coalescing is awkward cross-backend, so the OR covers both.
            .filter(
                job_run::Column::CreatedAt
                    .lt(older_than)
                    .or(job_run::Column::StartedAt.lt(older_than)),
            )
            .exec(self.db.as_ref())
            .await?
            .rows_affected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ConnectionTrait;
    use sea_orm::Set;

    async fn mem_store() -> Arc<DbJobStore> {
        use sea_orm::Database;
        let db = Database::connect("sqlite::memory:").await.unwrap();
        // Create the tables (mirrors the migration DDL).
        db.execute_unprepared(
            r#"CREATE TABLE scheduled_job (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                interval_days INTEGER NOT NULL DEFAULT 14,
                at_hour INTEGER NOT NULL DEFAULT 2,
                at_minute INTEGER NOT NULL DEFAULT 0,
                next_run_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .await
        .unwrap();
        db.execute_unprepared(
            r#"CREATE TABLE job_run (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL,
                detail TEXT,
                error TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL
            )"#,
        )
        .await
        .unwrap();
        Arc::new(DbJobStore::new(Arc::new(db)))
    }

    fn schedule(
        job_type: &str,
        enabled: bool,
        next_run_at: Option<String>,
    ) -> scheduled_job::ActiveModel {
        let now = now_iso();
        scheduled_job::ActiveModel {
            id: Set(Uuid::new_v4()),
            job_type: Set(job_type.into()),
            enabled: Set(enabled),
            interval_days: Set(14),
            at_hour: Set(2),
            at_minute: Set(0),
            next_run_at: Set(next_run_at),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        }
    }

    #[tokio::test]
    async fn due_schedule_query_matches_lexicographic_iso() {
        let store = mem_store().await;
        store
            .insert_schedule(schedule(
                "due.job",
                true,
                Some("2026-09-01T18:00:00Z".into()),
            ))
            .await
            .unwrap();
        store
            .insert_schedule(schedule(
                "future.job",
                true,
                Some("2026-12-01T18:00:00Z".into()),
            ))
            .await
            .unwrap();
        store
            .insert_schedule(schedule(
                "disabled.job",
                false,
                Some("2026-09-01T18:00:00Z".into()),
            ))
            .await
            .unwrap();
        store
            .insert_schedule(schedule("unarmed.job", true, None))
            .await
            .unwrap();

        let due = store
            .find_due_schedules("2026-09-02T00:00:00Z")
            .await
            .unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].job_type, "due.job");
    }

    #[tokio::test]
    async fn active_run_and_latest_run() {
        let store = mem_store().await;
        // A finished old run…
        let old = job_run::ActiveModel {
            id: Set(Uuid::new_v4()),
            job_type: Set("osm.import".into()),
            status: Set(status::SUCCEEDED.into()),
            detail: Set(None),
            error: Set(None),
            started_at: Set(Some("2026-08-01T18:00:00Z".into())),
            finished_at: Set(Some("2026-08-01T19:30:00Z".into())),
            created_at: Set("2026-08-01T17:59:00Z".into()),
        };
        store.insert_run(old).await.unwrap();
        assert!(store.find_active_run("osm.import").await.unwrap().is_none());
        let latest = store.latest_run("osm.import").await.unwrap().unwrap();
        assert_eq!(latest.status, "succeeded");

        // …then a queued run appears → active + still latest.
        let queued = job_run::ActiveModel {
            id: Set(Uuid::new_v4()),
            job_type: Set("osm.import".into()),
            status: Set(status::QUEUED.into()),
            detail: Set(None),
            error: Set(None),
            started_at: Set(None),
            finished_at: Set(None),
            created_at: Set("2026-09-01T18:00:00Z".into()),
        };
        let queued = store.insert_run(queued).await.unwrap();
        assert_eq!(
            store
                .find_active_run("osm.import")
                .await
                .unwrap()
                .unwrap()
                .id,
            queued.id
        );
        assert_eq!(
            store.latest_run("osm.import").await.unwrap().unwrap().id,
            queued.id
        );
        assert_eq!(store.count_runs("osm.import").await.unwrap(), 2);
    }

    #[tokio::test]
    async fn sweep_marks_stale_runs_failed() {
        let store = mem_store().await;
        let stale = job_run::ActiveModel {
            id: Set(Uuid::new_v4()),
            job_type: Set("osm.import".into()),
            status: Set(status::RUNNING.into()),
            detail: Set(None),
            error: Set(None),
            started_at: Set(Some("2026-08-01T18:00:00Z".into())),
            finished_at: Set(None),
            created_at: Set("2026-08-01T17:59:00Z".into()),
        };
        let stale = store.insert_run(stale).await.unwrap();

        let swept = store
            .sweep_stale_runs(&[status::RUNNING, status::QUEUED], "2026-09-01T00:00:00Z")
            .await
            .unwrap();
        assert_eq!(swept, 1);
        let swept = store.find_run(stale.id).await.unwrap().unwrap();
        assert_eq!(swept.status, "failed");
        assert!(swept.finished_at.is_some());
        assert!(swept.error.is_some());
    }

    #[tokio::test]
    async fn iso_roundtrip_is_exact() {
        let s = now_iso();
        assert_eq!(
            parse_iso(&s)
                .unwrap()
                .to_rfc3339_opts(SecondsFormat::Secs, true),
            s
        );
    }
}
