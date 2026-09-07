//! Row model for the `audit_log` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub actor_type: Option<String>,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub metadata: Option<String>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: String,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"audit_log\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"actor_type\", \"actor_id\", \"action\", \"target_type\", \"target_id\", \"metadata\", \"ip\", \"user_agent\", \"created_at\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
