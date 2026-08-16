//! DTOs for the notification service (`/api/notifications`,
//! `POST /api/notifications/read`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` for wire-shape
//! consistency with the rest of the API.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A notification row, as returned by `GET /api/notifications`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOut {
    pub id: Uuid,
    pub user_id: String,
    /// Notification kind: `booking_confirmed` | `price_drop` | `review_reply` | ...
    #[serde(rename = "type")]
    pub kind: String,
    pub title: Option<String>,
    pub body: Option<String>,
    /// Optional JSON-encoded payload (e.g. the booking id for a
    /// booking_confirmed notification).
    pub data: Option<String>,
    pub read: bool,
    pub created_at: String,
}

/// Response of `GET /api/notifications`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListResponse {
    pub items: Vec<NotificationOut>,
    pub total: u64,
    pub unread_count: u64,
    pub limit: u64,
    pub offset: u64,
}

/// Request body for `POST /api/notifications/read`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkNotificationsReadRequest {
    /// Notification ids to mark as read. When empty, ALL of the user's
    /// unread notifications are marked read.
    #[serde(default)]
    pub ids: Vec<Uuid>,
}

/// Response of `POST /api/notifications/read`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkNotificationsReadResponse {
    pub ok: bool,
    /// Number of rows actually updated.
    pub updated: u64,
}
