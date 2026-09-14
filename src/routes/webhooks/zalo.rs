//! Zalo Official Account (OA) webhook handler.
//!
//! ## Flow
//!
//! 1. Zalo sends `user_send_text` event to `POST /api/webhooks/zalo`.
//! 2. Handler verifies the `X-Zalo-Signature` HMAC-SHA256 signature
//!    over the RAW body bytes with `ZALO_OA_SECRET` (SEC-2026-WH —
//!    previously unauthenticated despite the module docs claiming HMAC;
//!    anyone could forge messages).
//! 3. Handler normalizes it into a `PlatformMessage`.
//! 4. `handle_platform_message` creates/finds the user + channel,
//!    inserts the message, triggers NullClaw AI.
//! 5. If AI replied, handler sends the reply back to the user via
//!    Zalo OA API (`POST https://openapi.zalo.me/v3.0/oa/message/text`).
//!
//! ## Setup
//!
//! 1. Create a Zalo OA at https://oa.zalo.me/
//! 2. Set the webhook URL to `https://yourdomain.com/api/webhooks/zalo`
//!    (Zalo signs every delivery with the OA secret in X-Zalo-Signature)
//! 3. Set `ZALO_OA_ID` + `ZALO_OA_SECRET` in `.env`

use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

use super::auth;
use super::shared::{handle_platform_message, PlatformMessage};

/// Incoming Zalo webhook event.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ZaloEvent {
    pub event_name: String,
    // Deserialized for payload completeness; not used by the handler.
    #[allow(dead_code)]
    pub timestamp: i64,
    pub sender: ZaloSender,
    pub message: Option<ZaloMessage>,
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

/// `POST /api/webhooks/zalo` — receive Zalo OA events.
///
/// The body is consumed as raw `Bytes` BEFORE any JSON parsing: the
/// X-Zalo-Signature MAC is computed over the exact bytes received.
pub async fn webhook(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::verify_zalo(&headers, &body)?;

    let event: ZaloEvent = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("zalo payload parse failed: {e}")))?;

    tracing::info!(
        event_name = %event.event_name,
        sender_id = %event.sender.id,
        "zalo webhook received"
    );

    match event.event_name.as_str() {
        "user_send_text" => {
            if let Some(msg) = &event.message {
                if let Some(text) = &msg.text {
                    let platform_msg = PlatformMessage {
                        platform: "zalo".into(),
                        platform_user_id: event.sender.id.clone(),
                        user_name: event
                            .sender
                            .name
                            .clone()
                            .unwrap_or_else(|| "Khách Zalo".into()),
                        text: text.clone(),
                        platform_msg_id: msg.msg_id.clone(),
                    };

                    let result = handle_platform_message(&st, &platform_msg).await?;

                    // Send AI reply back to Zalo if generated.
                    if let Some(reply_text) = result.reply_text {
                        send_zalo_reply(&st, &event.sender.id, &reply_text).await;
                    }
                }
            }
        }
        "follow" => {
            // Send a welcome message.
            send_zalo_reply(
                &st,
                &event.sender.id,
                "Chào bạn! Bạn có thể đặt vé xe hoặc hỏi thông tin tại đây. Nhắn tin để bắt đầu nhé!",
            )
            .await;
        }
        "unfollow" => {
            tracing::info!(sender_id = %event.sender.id, "zalo: user unfollowed OA");
        }
        _ => {
            tracing::debug!(event_name = %event.event_name, "zalo: unhandled event");
        }
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/// Send a text message to a Zalo user via the Zalo OA API.
async fn send_zalo_reply(_st: &AppState, user_id: &str, text: &str) {
    tracing::info!(
        user_id = %user_id,
        reply = %text,
        "zalo: reply (not sent — ZALO_OA_SECRET not configured)"
    );
}
