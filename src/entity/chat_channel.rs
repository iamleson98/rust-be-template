//! Row model for the `chat_channel` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub user_id: Uuid,
    pub brand_id: Option<Uuid>,
    pub topic: Option<String>,
    pub status: String,
    pub priority: String,
    pub last_message_at: Option<String>,
    pub last_message_preview: Option<String>,
    pub unread_user: i64,
    pub unread_employee: i64,
    pub created_at: String,
    pub closed_at: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"chat_channel\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"user_id\", \"brand_id\", \"topic\", \"status\", \"priority\", \"last_message_at\", \"last_message_preview\", \"unread_user\", \"unread_employee\", \"created_at\", \"closed_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
