//! Telegram Bot webhook handler.
//!
//! ## Flow
//!
//! 1. Telegram sends an Update to `POST /api/webhooks/telegram`.
//! 2. Handler normalizes it into a `PlatformMessage`.
//! 3. `handle_platform_message` creates/finds the user + channel,
//!    inserts the message, triggers NullClaw AI.
//! 4. If AI replied, handler sends the reply via Bot API
//!    (`POST https://api.telegram.org/bot<TOKEN>/sendMessage`).
//!
//! ## Setup
//!
//! 1. Create a bot via @BotFather on Telegram
//! 2. Set webhook URL:
//!    `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/webhooks/telegram`
//! 3. Set `TELEGRAM_BOT_TOKEN` in `.env`

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

use super::shared::{handle_platform_message, PlatformMessage};

/// Telegram Update (partial — only `message` field).
#[derive(Debug, Deserialize)]
pub struct TelegramUpdate {
    pub update_id: i64,
    pub message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramMessage {
    pub message_id: i64,
    pub from: Option<TelegramUser>,
    pub chat: TelegramChat,
    pub text: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelegramChat {
    pub id: i64,
}

/// `POST /api/webhooks/telegram` — receive Telegram Bot updates.
pub async fn webhook(
    State(st): State<AppState>,
    Json(update): Json<TelegramUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    if let Some(msg) = &update.message {
        if let Some(text) = &msg.text {
            let user_name = msg
                .from
                .as_ref()
                .map(|u| {
                    let parts: Vec<&str> = [u.first_name.as_deref(), u.last_name.as_deref()]
                        .iter()
                        .filter_map(|p| *p)
                        .collect();
                    if parts.is_empty() {
                        u.username.clone().unwrap_or_else(|| "TG User".into())
                    } else {
                        parts.join(" ")
                    }
                })
                .unwrap_or_else(|| "TG User".into());

            tracing::info!(
                chat_id = msg.chat.id,
                user_name = %user_name,
                "telegram: received text message"
            );

            let platform_msg = PlatformMessage {
                platform: "telegram".into(),
                platform_user_id: msg.chat.id.to_string(),
                user_name,
                text: text.clone(),
                platform_msg_id: Some(format!("tg-{}", msg.message_id)),
            };

            let result = handle_platform_message(&st, &platform_msg).await?;

            if let Some(reply_text) = result.reply_text {
                send_telegram_reply(&st, msg.chat.id, &reply_text).await;
            }
        }
    }

    Ok(Json(serde_json::json!({ "status": "ok" })))
}

/// Send a text message to a Telegram chat via the Bot API.
async fn send_telegram_reply(st: &AppState, chat_id: i64, text: &str) {
    // TODO: Read TELEGRAM_BOT_TOKEN from config + call:
    //
    // POST https://api.telegram.org/bot<TOKEN>/sendMessage
    // Body: { "chat_id": chat_id, "text": text, "parse_mode": "HTML" }
    tracing::info!(
        chat_id = %chat_id,
        reply = %text,
        "telegram: reply (not sent — TELEGRAM_BOT_TOKEN not configured)"
    );
}
