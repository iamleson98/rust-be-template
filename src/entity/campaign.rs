//! Row model for the `campaign` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub brand_id: Uuid,
    pub code: String,
    pub discount_type: String,
    pub discount_value: i64,
    pub max_uses: Option<i64>,
    pub used_count: i64,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"campaign\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"brand_id\", \"code\", \"discount_type\", \"discount_value\", \"max_uses\", \"used_count\", \"starts_at\", \"ends_at\", \"status\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
