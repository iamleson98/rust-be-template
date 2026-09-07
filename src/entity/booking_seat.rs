//! Row model for the `booking_seat` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub booking_id: Uuid,
    pub seat_id: Uuid,
    pub passenger_name: Option<String>,
    pub passenger_age: Option<i16>,
    pub passenger_type: Option<String>,
    pub price: i64,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"booking_seat\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"booking_id\", \"seat_id\", \"passenger_name\", \"passenger_age\", \"passenger_type\", \"price\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?";
