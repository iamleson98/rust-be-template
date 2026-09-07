//! Row model for the `discount_program` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub brand_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub discount_type: String,
    pub discount_value: i64,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub status: String,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"discount_program\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"brand_id\", \"name\", \"description\", \"discount_type\", \"discount_value\", \"starts_at\", \"ends_at\", \"status\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
