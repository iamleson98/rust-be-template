//! Row model for the `trip_session` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub departure_date: String,
    pub actual_departure_at: Option<String>,
    pub driver_name: Option<String>,
    pub driver_phone: Option<String>,
    pub status: String,
    pub total_seats: i64,
    pub available_seats: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"trip_session\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"schedule_id\", \"departure_date\", \"actual_departure_at\", \"driver_name\", \"driver_phone\", \"status\", \"total_seats\", \"available_seats\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
