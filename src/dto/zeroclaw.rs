//! DTOs for the ZeroClaw AI assistant endpoints
//! (`GET /api/zeroclaw/status`, `GET /api/zeroclaw/exchanges`).
//!
//! Replaces the previous opaque `serde_json::Value` responses — the
//! OpenAPI spec now has real schemas and the frontend's generated client
//! gets strong types.

use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// Response of `GET /api/zeroclaw/status`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ZeroclawStatusResponse {
    pub enabled: bool,
    /// Provider name (e.g. "http" or "stub").
    pub provider: &'static str,
}

/// A single ZeroClaw exchange row — the prompt + completion pair, with
/// metadata (model used, latency, handoff flag).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ZeroclawExchangeOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistant_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<i64>,
    pub handoff_to_human: bool,
    pub created_at: String,
}

/// Response of `GET /api/zeroclaw/exchanges`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ZeroclawExchangeListResponse {
    pub items: Vec<ZeroclawExchangeOut>,
}

impl From<crate::entity::zero_claw_exchange::Model> for ZeroclawExchangeOut {
    fn from(m: crate::entity::zero_claw_exchange::Model) -> Self {
        Self {
            id: m.id,
            channel_id: m.channel_id,
            user_message_id: m.user_message_id,
            assistant_message_id: m.assistant_message_id,
            prompt: m.prompt,
            completion: m.completion,
            model: m.model,
            latency_ms: m.latency_ms,
            handoff_to_human: m.handoff_to_human,
            created_at: m.created_at,
        }
    }
}
