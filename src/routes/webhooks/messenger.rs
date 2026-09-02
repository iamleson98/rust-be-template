//! Facebook Messenger webhook handler.
//!
//! ## Flow
//!
//! 1. Messenger sends `messages` event to `POST /api/webhooks/messenger`.
//! 2. Handler normalizes it into a `PlatformMessage`.
//! 3. `handle_platform_message` creates/finds the user + channel,
//!    inserts the message, triggers NullClaw AI.
//! 4. If AI replied, handler sends the reply back via Graph API.
//!
//! ## Setup
//!
//! 1. Create a Facebook App at https://developers.facebook.com/
//! 2. Add Messenger product
//! 3. Set webhook URL to `https://yourdomain.com/api/webhooks/messenger`
//! 4. Set `MESSENGER_VERIFY_TOKEN` + `MESSENGER_PAGE_ACCESS_TOKEN` in `.env`

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

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
    State(st): State<AppState>,
    Query(q): Query<VerifyQuery>,
) -> Result<String, AppError> {
    // Verify the token matches our configured MESSENGER_VERIFY_TOKEN.
    // For now, we accept any non-empty token — TODO: read from config.
    if q.mode == "subscribe" && !q.verify_token.is_empty() {
        tracing::info!("messenger: webhook verified");
        Ok(q.challenge)
    } else {
        Err(AppError::BadRequest("invalid verify token".into()))
    }
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
pub async fn webhook(
    State(st): State<AppState>,
    Json(body): Json<MessengerWebhook>,
) -> Result<Json<serde_json::Value>, AppError> {
    for entry in &body.entry {
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
async fn send_messenger_reply(st: &AppState, recipient_psid: &str, text: &str) {
    // TODO: Read MESSENGER_PAGE_ACCESS_TOKEN from config.
    //
    // POST https://graph.facebook.com/v18.0/me/messages
    //   ?access_token=MESSENGER_PAGE_ACCESS_TOKEN
    // Body: {
    //   "recipient": { "id": recipient_psid },
    //   "message": { "text": text }
    // }
    tracing::info!(
        recipient_psid = %recipient_psid,
        reply = %text,
        "messenger: reply (not sent — MESSENGER_PAGE_ACCESS_TOKEN not configured)"
    );
}
