//! Row model for the `chat_message` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub sender_type: String,
    pub sender_id: Option<Uuid>,
    pub content: Option<String>,
    pub kind: String,
    pub attachments: Option<String>,
    pub status: String,
    pub client_msg_id: Option<String>,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"chat_message\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"channel_id\", \"sender_type\", \"sender_id\", \"content\", \"kind\", \"attachments\", \"status\", \"client_msg_id\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
