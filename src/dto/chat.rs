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

/// The customer who started the channel. Embedded in [`ChatChannelOut`]
/// so the admin's channel list can display name / email / phone without
/// a second round-trip per channel.
#[derive(Debug, Serialize, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelUserOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
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
    /// The customer who started the channel. Populated by `list_channels`
    /// + `create_channel` (joined from the `user` table by `user_id`).
    ///
    /// `None` only when the user has been deleted (FK CASCADE clears
    /// the channel row, so this is rare).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<ChannelUserOut>,
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

/// Response of `GET /api/admin/chat/stats` — aggregate chat stats for
/// the admin dashboard's top-row cards.
///
/// - `openCount` — channels with `status='open'` (the support queue).
/// - `assignedCount` — channels with `status='assigned'` (being handled).
/// - `closedCount` — channels with `status='closed'` (resolved).
/// - `totalChannels` — sum of all statuses.
/// - `avgResponseTimeSecs` — average seconds between the first user
///   message + the first employee reply, across channels that have
///   both. `0.0` when no channels have a response yet.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatStatsResponse {
    pub open_count: i64,
    pub assigned_count: i64,
    pub closed_count: i64,
    pub total_channels: i64,
    pub avg_response_time_secs: f64,
}
