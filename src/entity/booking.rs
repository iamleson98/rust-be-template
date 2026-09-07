//! Row model for the `booking` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub code: String,
    pub user_id: Option<Uuid>,
    pub guest_name: Option<String>,
    pub guest_phone: Option<String>,
    pub guest_email: Option<String>,
    pub trip_session_id: Uuid,
    pub boarding_point_id: Option<Uuid>,
    pub dropping_point_id: Option<Uuid>,
    pub adult_count: i64,
    pub child_count: i64,
    pub subtotal: i64,
    pub discount: i64,
    pub fees: i64,
    pub total: i64,
    pub currency: String,
    pub status: String,
    pub payment_method: Option<String>,
    pub campaign_applied_id: Option<Uuid>,
    pub expires_at: Option<String>,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    pub contact_email: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub dropoff_address: Option<String>,
    pub dropoff_lat: Option<f64>,
    pub dropoff_lon: Option<f64>,
    pub dropoff_name: Option<String>,
    pub pickup_address: Option<String>,
    pub pickup_lat: Option<f64>,
    pub pickup_lon: Option<f64>,
    pub pickup_name: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"booking\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"code\", \"user_id\", \"guest_name\", \"guest_phone\", \"guest_email\", \"trip_session_id\", \"boarding_point_id\", \"dropping_point_id\", \"adult_count\", \"child_count\", \"subtotal\", \"discount\", \"fees\", \"total\", \"currency\", \"status\", \"payment_method\", \"campaign_applied_id\", \"expires_at\", \"contact_name\", \"contact_phone\", \"contact_email\", \"created_at\", \"updated_at\", \"dropoff_address\", \"dropoff_lat\", \"dropoff_lon\", \"dropoff_name\", \"pickup_address\", \"pickup_lat\", \"pickup_lon\", \"pickup_name\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
