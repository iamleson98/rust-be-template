//! Row model for the `jobs` table.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Alias kept from the SeaORM entities so call sites need no change.
pub type DateTimeUtc = DateTime<Utc>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: String,
    pub job_type: String,
    pub payload: String,
    pub attempts: i64,
    pub available_at: DateTimeUtc,
    pub created_at: DateTimeUtc,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"jobs\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"job_type\", \"payload\", \"attempts\", \"available_at\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?";
