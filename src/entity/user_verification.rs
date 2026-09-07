//! Row model for the `user_verification` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub user_id: Uuid,
    pub channel: String,
    pub target: String,
    pub code_hash: String,
    pub purpose: String,
    pub attempts: i64,
    pub expires_at: String,
    pub consumed_at: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"user_verification\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"user_id\", \"channel\", \"target\", \"code_hash\", \"purpose\", \"attempts\", \"expires_at\", \"consumed_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?";
