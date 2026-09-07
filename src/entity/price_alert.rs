//! Row model for the `price_alert` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub phone: String,
    pub email: Option<String>,
    pub from_name: Option<String>,
    pub to_name: Option<String>,
    pub route_id: Option<Uuid>,
    pub target_price: Option<i64>,
    pub frequency: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub user_id: Option<String>,
    pub last_triggered_at: Option<String>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"price_alert\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"phone\", \"email\", \"from_name\", \"to_name\", \"route_id\", \"target_price\", \"frequency\", \"status\", \"created_at\", \"expires_at\", \"user_id\", \"last_triggered_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
