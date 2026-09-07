//! Row model for the `bus_layout` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub brand_id: Option<Uuid>,
    pub name: Option<String>,
    pub vehicle_type: Option<String>,
    pub total_seats: Option<i16>,
    pub layout_data: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"bus_layout\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"brand_id\", \"name\", \"vehicle_type\", \"total_seats\", \"layout_data\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?";
