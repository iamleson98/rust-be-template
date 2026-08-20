//! DTOs for the chat REST endpoints (`POST /api/chat/channels`,
//! `POST /api/chat/channels/{id}/messages`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` for wire-shape
//! consistency with the rest of the API.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

/// Request body for `POST /api/chat/channels` (create a new chat channel).
#[derive(Debug, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelRequest {
    #[validate(length(max = 255))]
    pub topic: Option<String>,
    pub brand_id: Option<Uuid>,
}

/// Response of `POST /api/chat/channels`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelResponse {
    pub channel: ChatChannelOut,
}

/// A chat channel, as returned by `GET /api/chat/channels` and the
/// create-channel endpoint.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatChannelOut {
    pub id: Uuid,
    pub user_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message_preview: Option<String>,
    pub unread_user: i64,
    pub unread_employee: i64,
    pub created_at: String,
}

/// Request body for `POST /api/chat/channels/{id}/messages` (REST
/// fallback for when the WebSocket is unavailable).
#[derive(Debug, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageRequest {
    #[validate(length(max = 10000))]
    pub content: Option<String>,
    #[serde(default = "default_kind")]
    #[validate(length(max = 20))]
    pub kind: String,
    #[serde(default)]
    #[validate(length(max = 16384))]
    pub attachments: Option<String>,
    #[serde(default)]
    #[validate(length(max = 100))]
    pub client_msg_id: Option<String>,
}

fn default_kind() -> String {
    "text".into()
}

/// Response of `POST /api/chat/channels/{id}/messages`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageResponse {
    pub message: ChatMessageOut,
}

/// A chat message, as returned by `GET /api/chat/channels/{id}/messages`
/// and the post-message endpoint.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageOut {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub sender_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<String>,
    pub created_at: String,
}

// ────────────────────────────────────────────────────────────────
//  List responses
// ────────────────────────────────────────────────────────────────

/// Response of `GET /api/chat/channels`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatChannelListResponse {
    pub items: Vec<ChatChannelOut>,
}

/// Response of `GET /api/chat/channels/{id}/messages`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageListResponse {
    pub items: Vec<ChatMessageOut>,
}

/// Response of `POST /api/chat/channels/{id}/read`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkChannelReadResponse {
    pub ok: bool,
}
