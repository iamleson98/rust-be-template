//! Row model for the `null_claw_exchange` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub channel_id: Option<Uuid>,
    pub user_message_id: Option<Uuid>,
    pub assistant_message_id: Option<Uuid>,
    pub prompt: Option<String>,
    pub completion: Option<String>,
    pub model: Option<String>,
    pub latency_ms: Option<i64>,
    pub handoff_to_human: bool,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"null_claw_exchange\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"channel_id\", \"user_message_id\", \"assistant_message_id\", \"prompt\", \"completion\", \"model\", \"latency_ms\", \"handoff_to_human\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
