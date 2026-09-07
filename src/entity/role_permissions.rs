//! Row model for the `role_permissions` table.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Alias kept from the SeaORM entities so call sites need no change.
pub type DateTimeUtc = DateTime<Utc>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub role_id: Uuid,
    pub permission_id: Uuid,
    pub assigned_at: DateTimeUtc,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"role_permissions\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"role_id\", \"permission_id\", \"assigned_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?";
