//! Row model for the `seat` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub bus_layout_id: Uuid,
    pub seat_label: String,
    pub seat_class: Option<String>,
    pub row_num: Option<i16>,
    pub col_num: Option<i16>,
    pub is_window: bool,
    pub floor: i16,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"seat\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"bus_layout_id\", \"seat_label\", \"seat_class\", \"row_num\", \"col_num\", \"is_window\", \"floor\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?";
