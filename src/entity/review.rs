//! Row model for the `review` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub booking_id: Option<Uuid>,
    pub trip_session_id: Option<Uuid>,
    pub route_id: Option<Uuid>,
    pub brand_id: Option<Uuid>,
    pub author_name: Option<String>,
    pub author_phone: Option<String>,
    pub rating: i64,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<String>,
    pub photos: Option<String>,
    pub status: String,
    pub helpful_count: i64,
    pub reply: Option<String>,
    pub replied_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub user_id: Option<Uuid>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"review\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"booking_id\", \"trip_session_id\", \"route_id\", \"brand_id\", \"author_name\", \"author_phone\", \"rating\", \"title\", \"content\", \"tags\", \"photos\", \"status\", \"helpful_count\", \"reply\", \"replied_at\", \"created_at\", \"updated_at\", \"user_id\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
