//! Telegram Bot webhook handler (stub).
//!
//! ## Setup
//! 1. Create a bot via @BotFather on Telegram
//! 2. Set webhook URL: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/webhooks/telegram
//! 3. Set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_SECRET` in `.env`

use axum::extract::State;
use axum::Json;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

/// `POST /api/webhooks/telegram` — receive Telegram Bot updates.
///
/// TODO: Implement full Telegram webhook handler:
/// - Verify `X-Telegram-Bot-Api-Secret-Token` header
/// - Parse `update.message.text` + `update.message.from`
/// - Map Telegram user ID → platform user → chat channel
/// - Insert message + trigger NullClaw AI
/// - Send reply via Bot API: POST https://api.telegram.org/bot<TOKEN>/sendMessage
pub async fn webhook(
    State(_st): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::info!("telegram: webhook received (not yet implemented)");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}
