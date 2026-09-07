//! Row model for the `schedule` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub route_id: Uuid,
    pub departure_time: String,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    pub days_of_week: Option<String>,
    pub bus_layout_id: Option<Uuid>,
    pub base_price_adult: i64,
    pub base_price_child: Option<i64>,
    pub amenities: Option<String>,
    pub created_at: String,
    pub vehicle_type_id: Option<Uuid>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"schedule\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"route_id\", \"departure_time\", \"effective_from\", \"effective_to\", \"days_of_week\", \"bus_layout_id\", \"base_price_adult\", \"base_price_child\", \"amenities\", \"created_at\", \"vehicle_type_id\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
