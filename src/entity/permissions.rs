//! Row model for the `permissions` table.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Alias kept from the SeaORM entities so call sites need no change.
pub type DateTimeUtc = DateTime<Utc>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: DateTimeUtc,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"permissions\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"name\", \"description\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?";
