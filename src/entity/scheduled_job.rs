//! `SeaORM` Entity — recurring (cron-style) job schedule.
//!
//! A scheduled job describes WHEN a background job type should be
//! enqueued onto the worker queue: every `interval_days` at
//! `at_hour:at_minute` wall-clock time (interpreted in the scheduler's
//! configured timezone — fixed-offset UTC+7 for Vietnam by default).
//!
//! `next_run_at` is the authoritative next fire time: the scheduler tick
//! enqueues the job and advances it. Rows are seeded by code
//! (`JobService::ensure_default_jobs`), not by the migration, so the
//! first `next_run_at` is computed relative to the first server boot.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "scheduled_job")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// Worker job type this schedule drives (e.g. `osm.import`). Unique.
    #[sea_orm(column_type = "String(StringLen::N(100))")]
    pub job_type: String,
    /// Master switch — a disabled schedule is never fired by the tick.
    pub enabled: bool,
    /// Days between runs (e.g. 14 = biweekly).
    pub interval_days: i32,
    /// Local hour (0-23) of the daily fire time.
    pub at_hour: i32,
    /// Local minute (0-59) of the daily fire time.
    pub at_minute: i32,
    /// Next fire time as ISO-8601 UTC (`…Z`, second precision).
    /// `None` while the schedule has never been armed.
    #[sea_orm(column_type = "Text", nullable)]
    pub next_run_at: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
    #[sea_orm(column_type = "Text")]
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
