//! Discord Bot webhook handler.
//!
//! ## Flow
//!
//! 1. Discord sends an Interaction to `POST /api/webhooks/discord`.
//! 2. If it's a PING (type 1), respond with `{"type": 1}` immediately.
//! 3. If it's a message command (type 2) with a text input, normalize
//!    it into a `PlatformMessage`.
//! 4. `handle_platform_message` creates/finds the user + channel,
//!    inserts the message, triggers NullClaw AI.
//! 5. If AI replied, respond with the reply text in the interaction
//!    response body.
//!
//! ## Setup
//!
//! 1. Create a Discord Application at https://discord.com/developers/applications
//! 2. Add a Bot + configure Interactions Endpoint URL to
//!    `https://yourdomain.com/api/webhooks/discord`
//! 3. Set `DISCORD_PUBLIC_KEY` + `DISCORD_BOT_TOKEN` in `.env`

use axum::extract::State;
use axum::Json;
use serde::Deserialize;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

use super::shared::{handle_platform_message, PlatformMessage};

/// Discord Interaction (partial).
#[derive(Debug, Deserialize)]
pub struct DiscordInteraction {
    #[serde(rename = "type")]
    pub interaction_type: i64,
    pub data: Option<DiscordInteractionData>,
    pub member: Option<DiscordMember>,
    pub channel_id: Option<String>,
    pub id: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DiscordInteractionData {
    pub content: Option<String>,
    pub options: Option<Vec<DiscordOption>>,
}

#[derive(Debug, Deserialize)]
pub struct DiscordOption {
    pub name: String,
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DiscordMember {
    pub user: Option<DiscordUser>,
}

#[derive(Debug, Deserialize)]
pub struct DiscordUser {
    pub id: String,
    pub username: Option<String>,
    pub global_name: Option<String>,
}

/// `POST /api/webhooks/discord` — receive Discord interaction events.
pub async fn webhook(
    State(st): State<AppState>,
    Json(interaction): Json<DiscordInteraction>,
) -> Result<Json<serde_json::Value>, AppError> {
    // PING (type 1) — Discord sends this on first setup.
    if interaction.interaction_type == 1 {
        return Ok(Json(serde_json::json!({ "type": 1 })));
    }

    // APPLICATION_COMMAND (type 2) or MESSAGE_COMPONENT (type 3).
    // Extract the text from the interaction data.
    if let Some(data) = &interaction.data {
        let text = data.content.clone().or_else(|| {
            // If the command has options, look for a "text" or "message" option.
            data.options.as_ref().and_then(|opts| {
                opts.iter()
                    .find(|o| o.name == "text" || o.name == "message")
                    .and_then(|o| o.value.clone())
            })
        });

        if let Some(text) = text {
            let user = interaction.member.as_ref().and_then(|m| m.user.as_ref());

            let user_id = user
                .map(|u| u.id.clone())
                .unwrap_or_else(|| "unknown".into());
            let user_name = user
                .and_then(|u| u.global_name.clone().or_else(|| u.username.clone()))
                .unwrap_or_else(|| "Discord User".into());

            tracing::info!(
                user_id = %user_id,
                user_name = %user_name,
                "discord: received command"
            );

            let platform_msg = PlatformMessage {
                platform: "discord".into(),
                platform_user_id: user_id,
                user_name,
                text,
                platform_msg_id: interaction.id.clone(),
            };

            let result = handle_platform_message(&st, &platform_msg).await?;

            if let Some(reply_text) = result.reply_text {
                // Discord expects the reply in the interaction response
                // body (type 4 = CHANNEL_MESSAGE_WITH_SOURCE).
                return Ok(Json(serde_json::json!({
                    "type": 4,
                    "data": { "content": reply_text }
                })));
            }

            // No AI reply — respond with a simple confirmation.
            return Ok(Json(serde_json::json!({
                "type": 4,
                "data": { "content": "Tin nhắn của bạn đã được ghi nhận. Nhân viên sẽ phản hồi sớm." }
            })));
        }
    }

    // Unknown interaction type — acknowledge.
    Ok(Json(serde_json::json!({ "type": 5 })))
}
