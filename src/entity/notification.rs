//! Row model for the `notification` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub user_id: Uuid,
    pub title: Option<String>,
    pub body: Option<String>,
    pub data: Option<String>,
    pub read: bool,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"notification\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"user_id\", \"title\", \"body\", \"data\", \"read\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?";
