//! Row model for the `pickup_point` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub route_id: Uuid,
    pub name: Option<String>,
    pub address: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub stop_order: i64,
    pub kind: Option<String>,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"pickup_point\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"route_id\", \"name\", \"address\", \"lat\", \"lon\", \"stop_order\", \"kind\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?";
