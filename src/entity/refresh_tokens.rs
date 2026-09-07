//! Row model for the `refresh_tokens` table.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Alias kept from the SeaORM entities so call sites need no change.
pub type DateTimeUtc = DateTime<Utc>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub issued_at: DateTimeUtc,
    pub expires_at: DateTimeUtc,
    pub revoked: bool,
    pub user_agent: Option<String>,
    pub ip: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"refresh_tokens\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"user_id\", \"token_hash\", \"issued_at\", \"expires_at\", \"revoked\", \"user_agent\", \"ip\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?";
