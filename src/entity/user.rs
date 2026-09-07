//! Row model for the `user` table.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Alias kept from the SeaORM entities so call sites need no change.
pub type DateTimeUtc = DateTime<Utc>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub brand_id: Option<Uuid>,
    pub full_name: String,
    pub email: String,
    pub phone: Option<String>,
    pub email_verified_at: Option<String>,
    pub phone_verified_at: Option<String>,
    pub status: String,
    pub block_reason: Option<String>,
    pub password_hash: Option<String>,
    pub avatar_url: Option<String>,
    pub locale: String,
    pub is_guest: bool,
    pub role: String,
    pub failed_login_attempts: i64,
    pub locked_until: Option<String>,
    pub last_login_at: Option<String>,
    pub last_login_ip: Option<String>,
    pub password_changed_at: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub oauth_provider: Option<String>,
    pub oauth_subject: Option<String>,
    pub is_bot: bool,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"user\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"brand_id\", \"full_name\", \"email\", \"phone\", \"email_verified_at\", \"phone_verified_at\", \"status\", \"block_reason\", \"password_hash\", \"avatar_url\", \"locale\", \"is_guest\", \"role\", \"failed_login_attempts\", \"locked_until\", \"last_login_at\", \"last_login_ip\", \"password_changed_at\", \"created_at\", \"updated_at\", \"oauth_provider\", \"oauth_subject\", \"is_bot\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
