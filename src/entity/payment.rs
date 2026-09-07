//! Row model for the `payment` table.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, FromRow)]
pub struct Model {
    pub id: Uuid,
    pub booking_id: Uuid,
    pub user_id: Option<Uuid>,
    pub provider: String,
    pub status: String,
    pub amount: i64,
    pub currency: String,
    pub created_at: String,
    pub updated_at: String,
    pub provider_txn_ref: String,
    pub provider_trans_id: Option<String>,
    pub gateway_url: Option<String>,
    pub qr_payload: Option<String>,
    pub memo: Option<String>,
    pub provider_response: Option<String>,
    pub failure_reason: Option<String>,
    pub created_by: Option<Uuid>,
    pub collected_at: Option<String>,
    pub collected_by: Option<Uuid>,
}

/// Table name, quoted for use in raw SQL.
pub const TABLE: &str = "\"payment\"";

/// Every column in `Model` field order — a `SELECT {COLUMNS}` maps
/// straight onto `Model` via `FromRow`.
pub const COLUMNS: &str = "\"id\", \"booking_id\", \"user_id\", \"provider\", \"status\", \"amount\", \"currency\", \"created_at\", \"updated_at\", \"provider_txn_ref\", \"provider_trans_id\", \"gateway_url\", \"qr_payload\", \"memo\", \"provider_response\", \"failure_reason\", \"created_by\", \"collected_at\", \"collected_by\"";

/// `?` placeholder list matching [`COLUMNS`], for `INSERT` statements.
pub const PLACEHOLDERS: &str = "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
