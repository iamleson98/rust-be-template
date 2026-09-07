//! Row model for the `address` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub brand_id: Uuid,
    pub name: String,
    pub address: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub province: Option<String>,
    pub district: Option<String>,
    pub ward: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"address\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"brand_id\", \"name\", \"address\", \"lat\", \"lon\", \"province\", \"district\", \"ward\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
