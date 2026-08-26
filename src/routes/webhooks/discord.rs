//! Discord Bot webhook handler (stub).
//!
//! ## Setup
//! 1. Create a Discord Application at https://discord.com/developers/applications
//! 2. Add a Bot to the application
//! 3. Set the Interactions Endpoint URL to `https://yourdomain.com/api/webhooks/discord`
//! 4. Set `DISCORD_PUBLIC_KEY` + `DISCORD_BOT_TOKEN` in `.env`
//! 5. Verify Ed25519 signature on every request

use axum::extract::State;
use axum::Json;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

/// `POST /api/webhooks/discord` — receive Discord interaction events.
///
/// TODO: Implement full Discord webhook handler:
/// - Verify Ed25519 signature in X-Signature-Ed25519 header
/// - Parse interaction type (1 = PING, 2 = APPLICATION_COMMAND, etc.)
/// - For PING (type 1): return {"type": 1} immediately
/// - For messages: map Discord user ID → platform user → chat channel
/// - Insert message + trigger NullClaw AI
/// - Send reply via Discord Webhook URL or Bot API
pub async fn webhook(
    State(_st): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::info!("discord: webhook received (not yet implemented)");
    // Discord sends a PING (type 1) on first setup — respond with type 1.
    if let Some(t) = body.get("type").and_then(|v| v.as_i64()) {
        if t == 1 {
            return Ok(Json(serde_json::json!({ "type": 1 })));
        }
    }
    Ok(Json(serde_json::json!({ "status": "ok" })))
}
