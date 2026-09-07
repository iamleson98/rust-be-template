//! Row model for the `brand` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub logo_url: Option<String>,
    pub description: Option<String>,
    pub contact_phone: Option<String>,
    pub contact_email: Option<String>,
    pub rating: Option<f64>,
    pub status: String,
    pub accent_color: Option<String>,
    pub total_trips: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"brand\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"slug\", \"name\", \"logo_url\", \"description\", \"contact_phone\", \"contact_email\", \"rating\", \"status\", \"accent_color\", \"total_trips\", \"created_at\", \"updated_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
