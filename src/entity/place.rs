//! Row model for the `place` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub osm_id: i64,
    pub name: String,
    pub name_ascii: Option<String>,
    pub name_no_tones: Option<String>,
    pub province: Option<String>,
    pub district: Option<String>,
    pub ward: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub population: i64,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"place\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"osm_id\", \"name\", \"name_ascii\", \"name_no_tones\", \"province\", \"district\", \"ward\", \"lat\", \"lon\", \"population\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
