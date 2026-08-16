//! DTOs for the chat REST endpoints (`POST /api/chat/channels`,
//! `POST /api/chat/channels/{id}/messages`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` for wire-shape
//! consistency with the rest of the API.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// Request body for `POST /api/chat/channels` (create a new chat channel).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelRequest {
    /// Optional topic (e.g. "Hỗ trợ đặt vé"). Defaults to "Hỗ trợ" when omitted.
    #[serde(default)]
    pub topic: Option<String>,
    /// Optional brand id — when the user is asking about a specific
    /// brand, this routes the channel to that brand's support queue.
    #[serde(default)]
    pub brand_id: Option<String>,
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
    pub user_id: String,
    pub topic: Option<String>,
    pub status: String,
    pub brand_id: Option<String>,
    pub last_message_at: Option<String>,
    pub last_message_preview: Option<String>,
    pub unread_user: i64,
    pub unread_employee: i64,
    pub created_at: String,
}

/// Request body for `POST /api/chat/channels/{id}/messages` (REST
/// fallback for when the WebSocket is unavailable).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageRequest {
    /// Message text. Required for `kind="text"`.
    #[serde(default)]
    pub content: Option<String>,
    /// Message kind: `text` (default), `ticket`, `system`, ...
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Optional JSON-encoded attachments (e.g. ticket-card payload).
    #[serde(default)]
    pub attachments: Option<String>,
    /// Client-side correlation id for idempotency. When the same
    /// `client_msg_id` is sent twice, the second request returns the
    /// stored message instead of duplicating it.
    #[serde(default)]
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
    pub channel_id: String,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: Option<String>,
    pub kind: String,
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
