//! Row model for the `scheduled_job` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub job_type: String,
    pub enabled: bool,
    pub interval_days: i16,
    pub at_hour: i16,
    pub at_minute: i16,
    pub next_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"scheduled_job\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"job_type\", \"enabled\", \"interval_days\", \"at_hour\", \"at_minute\", \"next_run_at\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?";
