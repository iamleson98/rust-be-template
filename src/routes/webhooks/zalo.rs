//! Zalo Official Account (OA) webhook handler.
//!
//! Zalo sends events to the webhook URL when a user sends a message to
//! the OA. The event format is:
//!
//! ```json
//! {
//!   "event_name": "user_send_text",
//!   "timestamp": 1234567890,
//!   "sender": { "id": "user_id", "name": "User Name" },
//!   "message": { "text": "Hello", "msg_id": "msg_123" },
//!   "recipient": { "id": "oa_id" }
//! }
//! ```
//!
//! ## Setup
//!
//! 1. Create a Zalo OA at https://oa.zalo.me/
//! 2. Set the webhook URL to `https://yourdomain.com/api/webhooks/zalo`
//! 3. Set `ZALO_OA_ID` + `ZALO_OA_SECRET` in `.env`
//! 4. Subscribe to the `user_send_text` event

use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};
use tracing;

use crate::error::AppError;
use crate::state::AppState;

/// Incoming Zalo webhook event.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ZaloEvent {
    pub event_name: String,
    pub timestamp: i64,
    pub sender: ZaloSender,
    pub message: Option<ZaloMessage>,
    pub recipient: Option<ZaloRecipient>,
}

#[derive(Debug, Deserialize)]
pub struct ZaloSender {
    pub id: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ZaloMessage {
    pub text: Option<String>,
    pub msg_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ZaloRecipient {
    pub id: String,
}

/// Zalo OA API response (for sending replies).
#[derive(Debug, Serialize)]
pub struct ZaloReplyRequest {
    pub recipient: ZaloReplyRecipient,
    pub message: ZaloReplyMessage,
}

#[derive(Debug, Serialize)]
pub struct ZaloReplyRecipient {
    pub user_id: String,
}

#[derive(Debug, Serialize)]
pub struct ZaloReplyMessage {
    pub text: String,
}

/// `POST /api/webhooks/zalo` — receive Zalo OA events.
///
/// Handles:
/// - `user_send_text` — user sent a text message → forward to chat service
/// - `follow` — user followed the OA → welcome message
/// - `unfollow` — user unfollowed the OA → cleanup (no action for now)
pub async fn webhook(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(event): Json<ZaloEvent>,
) -> Result<Json<serde_json::Value>, AppError> {
    // TODO: Verify HMAC-SHA256 signature in X-Zalo-Signature header.
    // For now, log the event + process it.
    tracing::info!(
        event_name = %event.event_name,
        sender_id = %event.sender.id,
        "zalo webhook received"
    );

    match event.event_name.as_str() {
        "user_send_text" => {
            if let Some(msg) = &event.message {
                if let Some(text) = &msg.text {
                    // Forward the message to the chat service.
                    // The chat service will:
                    // 1. Find or create a channel for this Zalo user
                    //    (keyed by `zalo:{sender.id}`)
                    // 2. Insert the message as senderType='user'
                    // 3. Trigger NullClaw AI if no human is online
                    // 4. Send the AI reply back to Zalo via the OA API
                    //
                    // For now, we just log — the full implementation
                    // requires a "platform user" mapping table that
                    // maps `zalo:{user_id}` → a `user` row in the DB.
                    // That's a separate migration + entity change.
                    tracing::info!(
                        sender_id = %event.sender.id,
                        sender_name = ?event.sender.name,
                        text = %text,
                        "zalo: user sent text — forwarding to chat service (TODO: implement platform user mapping)"
                    );
                }
            }
        }
        "follow" => {
            tracing::info!(
                sender_id = %event.sender.id,
                "zalo: user followed OA — sending welcome"
            );
            // TODO: Send welcome message via Zalo OA API
        }
        "unfollow" => {
            tracing::info!(
                sender_id = %event.sender.id,
                "zalo: user unfollowed OA"
            );
        }
        _ => {
            tracing::debug!(
                event_name = %event.event_name,
                "zalo: unhandled event type"
            );
        }
    }

    // Always return 200 — Zalo retries on non-2xx.
    Ok(Json(serde_json::json!({ "status": "ok" })))
}
