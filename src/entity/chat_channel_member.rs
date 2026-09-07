//! Row model for the `chat_channel_member` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub joined_at: String,
    pub left_at: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"chat_channel_member\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"channel_id\", \"user_id\", \"role\", \"joined_at\", \"left_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?";
