//! Row model for the `seat_inventory` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub trip_session_id: Uuid,
    pub seat_id: Uuid,
    pub status: String,
    pub base_price: i64,
    pub final_price: i64,
    pub currency: String,
    pub held_until: Option<String>,
    pub held_by_booking_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"seat_inventory\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"trip_session_id\", \"seat_id\", \"status\", \"base_price\", \"final_price\", \"currency\", \"held_until\", \"held_by_booking_id\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
