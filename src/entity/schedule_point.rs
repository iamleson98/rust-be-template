//! Row model for the `schedule_point` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub address_id: Uuid,
    pub stop_order: i64,
    pub kind: String,
    pub created_at: String,
    pub arrival_time: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"schedule_point\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"schedule_id\", \"address_id\", \"stop_order\", \"kind\", \"created_at\", \"arrival_time\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?";
