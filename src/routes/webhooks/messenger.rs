//! Facebook Messenger webhook handler.
//!
//! ## Flow
//!
//! 1. Messenger sends `messages` event to `POST /api/webhooks/messenger`.
//! 2. Handler verifies the `X-Hub-Signature-256` HMAC-SHA256 signature
//!    over the RAW body bytes with `MESSENGER_APP_SECRET` (SEC-2026-WH —
//!    previously unauthenticated, anyone could forge messages).
//! 3. Handler normalizes it into a `PlatformMessage`.
//! 4. `handle_platform_message` creates/finds the user + channel,
//!    inserts the message, triggers NullClaw AI.
//! 5. If AI replied, handler sends the reply back via Graph API.
//!
//! ## Setup
//!
//! 1. Create a Facebook App at https://developers.facebook.com/
//! 2. Add Messenger product
//! 3. Set webhook URL to `https://yourdomain.com/api/webhooks/messenger`
//! 4. Set `MESSENGER_VERIFY_TOKEN` + `MESSENGER_PAGE_ACCESS_TOKEN` +
//!    `MESSENGER_APP_SECRET` (App Settings → Basic → App Secret) in `.env`

use axum::body::Bytes;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::Deserialize;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

use super::auth;
use super::shared::{handle_platform_message, PlatformMessage};

/// GET verification challenge — Messenger sends this when you first
/// set up the webhook.
#[derive(Deserialize)]
pub struct VerifyQuery {
    #[serde(rename = "hub.mode")]
    pub mode: String,
    #[serde(rename = "hub.verify_token")]
    pub verify_token: String,
    #[serde(rename = "hub.challenge")]
    pub challenge: String,
}

pub async fn verify(
    State(_st): State<AppState>,
    Query(q): Query<VerifyQuery>,
) -> Result<String, AppError> {
    // Constant-time compare against the configured MESSENGER_VERIFY_TOKEN
    // (SEC-2026-WH: previously accepted ANY non-empty token).
    if q.mode == "subscribe" {
        auth::verify_messenger_challenge(&q.verify_token)?;
        tracing::info!("messenger: webhook verified");
        return Ok(q.challenge);
    }
    Err(AppError::BadRequest("invalid hub.mode".into()))
}

/// Messenger webhook event shape (partial — only fields we use).
#[derive(Debug, Deserialize)]
pub struct MessengerWebhook {
    pub entry: Vec<MessengerEntry>,
}

#[derive(Debug, Deserialize)]
pub struct MessengerEntry {
    pub messaging: Vec<MessengerMessaging>,
}

#[derive(Debug, Deserialize)]
pub struct MessengerMessaging {
    pub sender: MessengerUser,
    // Deserialized for payload completeness; not used by the handler.
    #[allow(dead_code)]
    pub recipient: MessengerUser,
    pub message: Option<MessengerMsg>,
}

#[derive(Debug, Deserialize)]
pub struct MessengerUser {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct MessengerMsg {
    pub text: Option<String>,
    pub mid: Option<String>,
}

/// `POST /api/webhooks/messenger` — receive Messenger events.
///
/// The body is consumed as raw `Bytes` BEFORE any JSON parsing: the
/// X-Hub-Signature-256 MAC is computed over the exact bytes received,
/// and a JSON extractor would re-serialize the body and break the MAC.
pub async fn webhook(
    State(st): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    auth::verify_messenger(&headers, &body)?;

    let payload: MessengerWebhook = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("messenger payload parse failed: {e}")))?;

    for entry in &payload.entry {
        for msg in &entry.messaging {
            if let Some(message) = &msg.message {
                if let Some(text) = &message.text {
                    tracing::info!(
                        sender_id = %msg.sender.id,
                        "messenger: received text message"
                    );

                    let platform_msg = PlatformMessage {
                        platform: "messenger".into(),
                        platform_user_id: msg.sender.id.clone(),
                        user_name: format!(
                            "FB User {}",
                            &msg.sender.id[..8.min(msg.sender.id.len())]
                        ),
                        text: text.clone(),
                        platform_msg_id: message.mid.clone(),
                    };

                    let result = handle_platform_message(&st, &platform_msg).await?;

                    if let Some(reply_text) = result.reply_text {
                        send_messenger_reply(&st, &msg.sender.id, &reply_text).await;
                    }
                }
            }
        }
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/// Send a text message to a Messenger user via the Graph API.
async fn send_messenger_reply(_st: &AppState, recipient_psd: &str, text: &str) {
    // TODO: Read MESSENGER_PAGE_ACCESS_TOKEN from config.
    //
    // POST https://graph.facebook.com/v18.0/me/messages
    //   ?access_token=MESSENGER_PAGE_ACCESS_TOKEN
    // Body: {
    //   "recipient": { "id": recipient_psd },
    //   "message": { "text": text }
    // }
    tracing::info!(
        recipient_psd = %recipient_psd,
        reply = %text,
        "messenger: reply (not sent — MESSENGER_PAGE_ACCESS_TOKEN not configured)"
    );
}
