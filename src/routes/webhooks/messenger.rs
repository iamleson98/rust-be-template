//! Facebook Messenger webhook handler (stub).
//!
//! ## Setup
//! 1. Create a Facebook App at https://developers.facebook.com/
//! 2. Add Messenger product
//! 3. Set webhook URL to `https://yourdomain.com/api/webhooks/messenger`
//! 4. Set `MESSENGER_VERIFY_TOKEN` + `MESSENGER_PAGE_ACCESS_TOKEN` in `.env`
//! 5. Subscribe to `messages` event

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use tracing;

use crate::error::AppError;
use crate::state::AppState;

/// GET verification challenge — Messenger sends this when you first
/// set up the webhook. Echo back the `hub.challenge` parameter.
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
    // TODO: Verify q.verify_token matches MESSENGER_VERIFY_TOKEN env var.
    tracing::info!("messenger: webhook verification request");
    Ok(q.challenge)
}

/// `POST /api/webhooks/messenger` — receive Messenger events.
///
/// TODO: Implement full Messenger webhook handler:
/// - Parse the incoming `entry[].messaging[].message` payload
/// - Map sender PSID → platform user → chat channel
/// - Insert message + trigger NullClaw AI
/// - Send reply via Graph API: POST https://graph.facebook.com/v18.0/me/messages
pub async fn webhook(
    State(_st): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    tracing::info!("messenger: webhook received (not yet implemented)");
    Ok(Json(serde_json::json!({ "status": "ok" })))
}
