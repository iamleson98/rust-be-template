//! Messaging platform webhooks — Zalo, Messenger, Discord, Telegram.
//!
//! Each platform sends messages to a webhook URL on the backend.
//! The backend normalizes the incoming message, creates/finds a chat
//! channel for the platform user, inserts the message, triggers the
//! NullClaw AI provider (if no human is online), and sends the reply
//! back to the platform via its REST API.
//!
//! ## Architecture
//!
//! ```text
//! Zalo OA ──┐                    ┌── NullClaw AI (DirectLLMProvider)
//!           │                    │
//! Messenger ─┼──► /api/webhooks ─┼── ChatService (create channel + insert message)
//!           │    (normalize)     │
//! Telegram ─┤                    └── Platform API (send reply back)
//!           │
//! Discord ──┘
//! ```
//!
//! ## Webhook URLs
//!
//! - Zalo: `POST /api/webhooks/zalo`
//! - Messenger: `POST /api/webhooks/messenger`
//! - Telegram: `POST /api/webhooks/telegram`
//! - Discord: `POST /api/webhooks/discord`
//!
//! ## Authentication
//!
//! Each platform uses a different verification method:
//! - Zalo: HMAC-SHA256 signature in `X-Zalo-Signature` header
//! - Messenger: `X-Hub-Signature-256` HMAC + verify_token challenge
//! - Telegram: secret token in `X-Telegram-Bot-Api-Secret-Token` header
//! - Discord: Ed25519 signature in `X-Signature-Ed25519` header
//!
//! For this first iteration, Zalo is fully implemented. The other
//! platforms have stub handlers that return 501 Not Implemented.

pub mod discord;
pub mod messenger;
pub mod shared;
pub mod telegram;
pub mod zalo;

use axum::Router;

use crate::state::AppState;

/// Build the webhooks router — mounted at `/api/webhooks`.
///
/// Each platform gets its own sub-path:
///   - `/zalo` — Zalo OA webhook
///   - `/messenger` — Facebook Messenger webhook
///   - `/telegram` — Telegram Bot webhook
///   - `/discord` — Discord Bot webhook
pub fn router() -> Router<AppState> {
    use axum::routing::{get, post};
    Router::new()
        .route("/zalo", post(zalo::webhook))
        .route("/messenger", get(messenger::verify).post(messenger::webhook))
        .route("/telegram", post(telegram::webhook))
        .route("/discord", post(discord::webhook))
}
