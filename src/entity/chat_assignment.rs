//! Row model for the `chat_assignment` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub employee_id: Option<String>,
    pub assigned_at: String,
    pub unassigned_at: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"chat_assignment\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"channel_id\", \"employee_id\", \"assigned_at\", \"unassigned_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?";
