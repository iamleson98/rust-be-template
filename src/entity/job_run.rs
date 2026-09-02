//! `SeaORM` Entity — a single execution of a background job.
//!
//! One row is created when a job is enqueued (by the scheduler tick or
//! the admin "run now" button) and driven through the lifecycle
//! `queued → running → succeeded | failed` by the job handler itself.
//! `started_at` / `finished_at` give the run's wall-clock duration
//! ("work time" on the admin cron-jobs page); `detail` carries
//! machine-readable progress / stats JSON; `error` holds the terminal
//! failure message.
//!
//! The worker's at-most-once `jobs` queue table (see `worker::db`) is a
//! different thing: it holds in-flight envelopes only. This table is
//! the durable, user-visible history.

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Status values used by [`Model::status`].
pub mod status {
    /// Enqueued, not yet picked up by a worker.
    pub const QUEUED: &str = "queued";
    /// A worker handler is executing the job.
    pub const RUNNING: &str = "running";
    /// Completed successfully (`finished_at` set).
    pub const SUCCEEDED: &str = "succeeded";
    /// Terminated with an error (`error` + `finished_at` set).
    pub const FAILED: &str = "failed";
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "job_run")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// Worker job type (e.g. `osm.import`).
    #[sea_orm(column_type = "String(StringLen::N(100))")]
    pub job_type: String,
    /// One of [`status`] (`queued | running | succeeded | failed`).
    #[sea_orm(column_type = "String(StringLen::N(20))")]
    pub status: String,
    /// Progress / stats JSON (phase, bytes downloaded, docs indexed…).
    #[sea_orm(column_type = "Text", nullable)]
    pub detail: Option<String>,
    /// Terminal error message for failed runs.
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    /// ISO-8601 UTC — set when the handler starts.
    #[sea_orm(column_type = "Text", nullable)]
    pub started_at: Option<String>,
    /// ISO-8601 UTC — set when the handler finishes (either outcome).
    #[sea_orm(column_type = "Text", nullable)]
    pub finished_at: Option<String>,
    /// ISO-8601 UTC — set when the run row was created (enqueued).
    #[sea_orm(column_type = "Text")]
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
