//! Row model for the `route` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub brand_id: Option<Uuid>,
    pub name: String,
    pub start_location_id: String,
    pub end_location_id: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"route\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"brand_id\", \"name\", \"start_location_id\", \"end_location_id\", \"status\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?";
