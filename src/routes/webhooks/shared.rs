//! Shared logic for messaging-platform webhook handlers.
//!
//! Each platform (Zalo, Messenger, Telegram, Discord) normalizes its
//! incoming event into a [`PlatformMessage`] then calls
//! [`handle_platform_message`] which:
//!
//! 1. Finds or creates a "platform user" — a lightweight `user` row
//!    representing the external platform user (email:
//!    `{platform}:{platform_user_id}`, full_name: the platform display name).
//! 2. Finds or creates an OPEN chat channel for that user.
//! 3. Inserts the message as `sender_type='user'`.
//! 4. Checks if any human employees are online. If NOT, triggers the
//!    NullClaw AI provider to generate a reply.
//! 5. Returns the AI reply (if any) so the platform handler can send
//!    it back to the user via the platform's REST API.

use crate::auth::SessionUser;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::store::chat::NewChatMessage;
use crate::ws::hub::hub;

/// Normalized message from a messaging platform.
#[derive(Debug, Clone)]
pub struct PlatformMessage {
    pub platform: String,
    pub platform_user_id: String,
    pub user_name: String,
    pub text: String,
    pub platform_msg_id: Option<String>,
}

/// Result of handling a platform message.
#[derive(Debug)]
pub struct PlatformReply {
    pub reply_text: Option<String>,
}

/// Unified handler — called by each platform's webhook handler.
///
/// 1. Find or create a platform user.
/// 2. Find or create an OPEN chat channel.
/// 3. Insert the message.
/// 4. If no human employees are online, trigger NullClaw AI.
/// 5. Return the AI reply (if any).
pub async fn handle_platform_message(
    st: &AppState,
    msg: &PlatformMessage,
) -> AppResult<PlatformReply> {
    // ── 1. Find or create a platform user ──────────────────────────
    let platform_email = format!("{}:{}", msg.platform, msg.platform_user_id);
    let platform_email_for_session = platform_email.clone();
    let user = match st.auth.get_user_by_email(platform_email.clone()).await {
        Ok(Some(existing)) => existing,
        Ok(None) => {
            st.auth
                .create_platform_user(platform_email, msg.user_name.clone())
                .await?
        }
        Err(e) => return Err(AppError::Internal(e.to_string())),
    };

    // ── 2. Find or create an OPEN chat channel ─────────────────────
    let existing_channels = st
        .chats
        .list_channels(user.id, false, None, 50, 0)
        .await?;

    let channel = if let Some(open) = existing_channels.into_iter().find(|c| c.status == "open") {
        open
    } else {
        st.chats
            .create_channel(
                user.id,
                None,
                Some(format!("{} - {}", msg.platform, msg.user_name)),
            )
            .await?
    };

    // ── 3. Insert the message as sender_type='user' ────────────────
    let stored_msg = st
        .chats
        .insert_message(NewChatMessage {
            channel_id: channel.id,
            sender_type: "user".into(),
            sender_id: Some(user.id),
            content: Some(msg.text.clone()),
            kind: "text".into(),
            attachments: None,
            client_msg_id: msg.platform_msg_id.clone(),
        })
        .await?;

    // Update the channel preview.
    // Increment unread for employee side.
    let _ = st
        .chats
        .increment_unread(&channel.id.to_string(), "employee")
        .await;

    // Broadcast to WS room.
    let channel_id_str = channel.id.to_string();
    let broadcast = serde_json::json!({
        "type": "message",
        "id": stored_msg.id.to_string(),
        "channelId": channel_id_str,
        "senderType": "user",
        "senderId": user.id,
        "senderName": msg.user_name,
        "text": msg.text,
        "createdAt": stored_msg.created_at,
    });
    hub().broadcast_to_room(&channel_id_str, &broadcast);

    // Broadcast to employees for attention signal.
    hub().broadcast_to_staff(&serde_json::json!({
        "type": "channel_message",
        "channelId": channel_id_str,
        "senderId": user.id.to_string(),
        "senderName": msg.user_name,
        "preview": msg.text.chars().take(80).collect::<String>(),
        "createdAt": stored_msg.created_at,
    }));

    // ── 4. Trigger NullClaw AI if no humans online ─────────────────
    let online = hub().count_online_staff_total();
    let fallback_threshold = st.config.nullclaw.fallback_online_employees;

    if online >= fallback_threshold {
        tracing::debug!(
            channel_id = %channel_id_str,
            online,
            "platform msg: humans online — skipping AI"
        );
        return Ok(PlatformReply { reply_text: None });
    }

    let session_user = SessionUser {
        id: user.id,
        actor_type: "user".into(),
        role: "user".into(),
        name: msg.user_name.clone(),
        email: Some(platform_email_for_session),
        phone: None,
        avatar_url: None,
        brand_id: None,
        brand_name: None,
        employee_role: None,
    };

    let user_msg_id = stored_msg.id.to_string();
    let outcome = st
        .chats
        .maybe_nullclaw_reply(
            &channel_id_str,
            None,
            &session_user,
            &user_msg_id,
            &msg.text,
            online,
            fallback_threshold,
        )
        .await?;

    if let Some(outcome) = outcome {
        let sender_id = match outcome.bot_user_id {
            Some(id) => serde_json::Value::from(id.to_string()),
            None => serde_json::Value::from("nullclaw"),
        };
        let assistant_broadcast = serde_json::json!({
            "type": "message",
            "id": outcome.assistant_message_id,
            "channelId": channel_id_str,
            "senderType": "assistant",
            "senderId": sender_id,
            "senderName": crate::nullclaw::NULLCLAW_BOT_NAME,
            "text": outcome.reply.reply,
            "createdAt": outcome.created_at,
        });
        hub().broadcast_to_room(&channel_id_str, &assistant_broadcast);

        Ok(PlatformReply {
            reply_text: Some(outcome.reply.reply),
        })
    } else {
        Ok(PlatformReply { reply_text: None })
    }
}
