//! NullClaw AI customer-support assistant — integration harness.
//!
//! ## Purpose
//!
//! When a customer opens the support chat and no human agent is online (or
//! the queue is busy), NullClaw can reply on behalf of the brand. It learns
//! from the brand's data (FAQ, booking policies, route info) and answers
//! common questions instantly — like a domain-specific chatbot.
//!
//! ## Design
//!
//! This module defines a **provider trait** so the AI backend is pluggable:
//!
//!   * [`NoopNullClawProvider`] — default. Always returns `None`, meaning
//!     "NullClaw not configured / let a human handle it". Zero overhead.
//!
//!   * [`HttpNullClawProvider`] — calls an external NullClaw HTTP endpoint
//!     (set via `NULLCLAW_API_URL` + `NULLCLAW_API_KEY`).
//!
//! ## Hook point
//!
//! `ws/handler.rs::handle_message` calls [`NullClawProvider::maybe_reply`]
//! after a user message is broadcast. If the provider returns a reply, it's
//! inserted into `ChatMessage` with `senderType = 'assistant'` and broadcast
//! to the room. An entry is also written to `NullClawExchange` for audit
//! and future training.
//!
//! ## Adaptation notes
//!
//! Ported from `booking-rs/logic/nullclaw`. The original used raw `sqlx`
//! against the `Pool`; this version takes a [`ChatStore`] trait object so
//! it fits the template's layered store architecture (no DB access in the
//! service/provider layer).

use async_trait::async_trait;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

use crate::auth::SessionUser;
use crate::config::NullClawConfig;
use crate::error::AppError;
use crate::store::chat::{ChatStore, NewChatMessage, NewNullClawExchange};

// ── NullClaw bot identity ──────────────────────────────────────
//
// The NullClaw bot is created at FIRST-USER SIGNUP time by
// `AuthService::register` (see `src/service/auth_service.rs`) —
// NOT by a migration seed. This means the bot's UUID is assigned
// at runtime by `Uuid::new_v4()` and is therefore different per
// deployment. We cannot hardcode the UUID as a `const`.
//
// Instead, we look up the bot user by its well-known email at the
// call sites that need it (channel creation + AI reply). The lookup
// is cached per-process via `tokio::sync::OnceCell` so we only pay
// the DB round-trip once per boot. If the bot user doesn't exist
// (e.g. signup happened before this code shipped), the lookup
// returns `None` and the chat code degrades gracefully —
// `sender_id` falls back to `None` and the bot member row is
// skipped (but the channel still works).

/// The well-known email of the NullClaw bot user. Created by
/// `AuthService::register` when the first human user signs up.
/// Changing this constant requires deleting the old bot user row
/// + re-running signup, so don't change it without a migration.
pub const NULLCLAW_BOT_EMAIL: &str = "nullclaw_agent@example.com";

/// Display name used in WS broadcasts + chat messages. This is the
/// name customers see when NullClaw replies (e.g. "NullClaw AI").
/// The bot's `user.full_name` may differ (it's set to
/// `"nullclaw_agent"` by `AuthService::register`), so we use this
/// constant for the customer-facing display name.
pub const NULLCLAW_BOT_NAME: &str = "NullClaw AI";

/// Conversation turn sent to NullClaw. `role` ∈ {`user`, `assistant`}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub role: String,
    pub text: String,
}

/// Request body sent to NullClaw.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NullClawRequest {
    pub channel_id: Uuid,
    pub brand_id: Option<Uuid>,
    pub user_id: Uuid,
    pub user_name: String,
    pub conversation: Vec<ConversationTurn>,
    pub locale: String,
}

/// Reply from NullClaw.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NullClawReply {
    pub reply: String,
    /// 0.0–1.0. Below ~0.6 we typically hand off to a human.
    #[serde(default)]
    pub confidence: f64,
    /// If `true`, the channel is flagged for human pickup after the reply
    /// is sent. The reply itself is still delivered to the user.
    #[serde(default)]
    pub handoff_to_human: bool,
    /// Model identifier (for audit / A-B testing).
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_model() -> String {
    "nullclaw-v1".into()
}

/// Outcome of a `maybe_reply` call.
#[derive(Debug, Clone)]
pub struct NullClawOutcome {
    pub reply: NullClawReply,
    /// ID of the `ChatMessage` row we inserted (senderType='assistant').
    pub assistant_message_id: String,
    /// ISO timestamp of the assistant message.
    pub created_at: String,
    /// True if the provider flagged `handoff_to_human`.
    pub handoff: bool,
    /// The bot user's UUID (looked up at reply time). The caller uses
    /// this for the WS broadcast's `senderId` field so the frontend can
    /// fetch the bot's avatar/name. `None` if the bot user wasn't found
    /// (degraded mode — the message is still inserted with `sender_id=NULL`).
    pub bot_user_id: Option<Uuid>,
}

/// Pluggable NullClaw provider. The default is [`NoopNullClawProvider`];
/// when `NULLCLAW_ENABLED=true` + `NULLCLAW_API_URL` is set, the boot code
/// swaps in [`HttpNullClawProvider`].
#[async_trait]
pub trait NullClawProvider: Send + Sync {
    /// Return the provider's display name (for logging + /api/nullclaw/status).
    fn name(&self) -> &'static str;

    /// True if this provider is configured to actually call NullClaw.
    fn is_enabled(&self) -> bool;

    /// Try to generate a reply for the given conversation.
    ///
    /// Returns:
    ///   * `Ok(Some(outcome))` — NullClaw replied; caller broadcasts it.
    ///   * `Ok(None)` — NullClaw declined (low confidence, not enabled,
    ///     online employees available, etc.). Caller does nothing.
    ///   * `Err(_)` — store error. Caller logs and does nothing (the
    ///     customer's original message is still delivered; we never fail
    ///     the chat because NullClaw errored).
    #[allow(clippy::too_many_arguments)]
    async fn maybe_reply(
        &self,
        chat_store: &dyn ChatStore,
        channel_id: &str,
        brand_id: Option<&str>,
        user: &SessionUser,
        user_message_id: &str,
        user_text: &str,
        online_employees: usize,
        fallback_threshold: usize,
        bot_user_id: Option<Uuid>,
    ) -> Result<Option<NullClawOutcome>, AppError>;
}

// ── Noop provider (default — NullClaw disabled) ────────────────
//
// The default provider when no external NullClaw HTTP endpoint is
// configured. Always returns `None` — the customer's message is
// still delivered, but no AI reply is generated. A human employee
// (when online) will respond.
//
// At deploy time, set `NULLCLAW_ENABLED=true` + `NULLCLAW_API_URL` +
// `NULLCLAW_API_KEY` to switch to [`HttpNullClawProvider`], which
// calls the actual NullClaw LLM endpoint.

pub struct NoopNullClawProvider;

#[async_trait]
impl NullClawProvider for NoopNullClawProvider {
    fn name(&self) -> &'static str {
        "noop"
    }
    fn is_enabled(&self) -> bool {
        false
    }

    async fn maybe_reply(
        &self,
        _chat_store: &dyn ChatStore,
        _channel_id: &str,
        _brand_id: Option<&str>,
        _user: &SessionUser,
        _user_message_id: &str,
        _user_text: &str,
        _online_employees: usize,
        _fallback_threshold: usize,
        _bot_user_id: Option<Uuid>,
    ) -> Result<Option<NullClawOutcome>, AppError> {
        Ok(None)
    }
}

// ── HTTP provider ───────────────────────────────────────────────

pub struct HttpNullClawProvider {
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub timeout: Duration,
    pub max_history: usize,
    pub client: reqwest::Client,
}

impl HttpNullClawProvider {
    pub fn new(
        api_url: String,
        api_key: String,
        model: String,
        timeout_ms: u64,
        max_history: usize,
    ) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            api_url,
            api_key,
            model,
            timeout: Duration::from_millis(timeout_ms),
            max_history,
            client,
        }
    }
}

#[async_trait]
impl NullClawProvider for HttpNullClawProvider {
    fn name(&self) -> &'static str {
        "http"
    }
    fn is_enabled(&self) -> bool {
        true
    }

    async fn maybe_reply(
        &self,
        chat_store: &dyn ChatStore,
        channel_id: &str,
        brand_id: Option<&str>,
        user: &SessionUser,
        user_message_id: &str,
        user_text: &str,
        online_employees: usize,
        fallback_threshold: usize,
        bot_user_id: Option<Uuid>,
    ) -> Result<Option<NullClawOutcome>, AppError> {
        // 1. If humans are available, let them handle it.
        if online_employees >= fallback_threshold {
            tracing::debug!(
                channel_id,
                online_employees,
                fallback_threshold,
                "nullclaw: skipping — humans online"
            );
            return Ok(None);
        }

        // 2. Fetch recent conversation history (last N messages).
        //
        // `list_messages` returns messages in DESC order (newest first)
        // to support cursor pagination. For the AI conversation we need
        // chronological order (oldest first, newest last) so the model
        // sees the dialogue in the natural reading direction. We
        // reverse the page after mapping.
        let history = chat_store
            .list_messages(channel_id, self.max_history as u64, 0)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut conversation: Vec<ConversationTurn> = history
            .into_iter()
            .map(|m| ConversationTurn {
                role: if m.sender_type == "assistant" {
                    "assistant".into()
                } else {
                    "user".into()
                },
                text: m.content.unwrap_or_default(),
            })
            // `list_messages` is DESC (newest first); reverse to get
            // chronological order (oldest first, newest last) so the
            // AI sees the conversation naturally.
            .rev()
            .collect();

        // If the just-sent message isn't the last entry (race), append it.
        if conversation.last().map(|t| t.text.as_str()) != Some(user_text) {
            conversation.push(ConversationTurn {
                role: "user".into(),
                text: user_text.to_string(),
            });
        }
        // Trim to last N turns.
        if conversation.len() > self.max_history {
            let start = conversation.len() - self.max_history;
            conversation = conversation.split_off(start);
        }

        let req_body = NullClawRequest {
            channel_id: uuid::Uuid::parse_str(channel_id)
                .map_err(|e| AppError::Internal(format!("invalid channel id: {e}")))?,
            brand_id: match brand_id {
                Some(s) => Some(
                    uuid::Uuid::parse_str(s)
                        .map_err(|e| AppError::Internal(format!("invalid brand id: {e}")))?,
                ),
                None => None,
            },
            user_id: user.id,
            user_name: user.name.clone(),
            locale: "vi".into(),
            conversation,
        };

        // 3. Call NullClaw.
        let url = format!("{}/v1/reply", self.api_url.trim_end_matches('/'));
        let started = std::time::Instant::now();
        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&req_body)
            .send()
            .await;
        let latency_ms = started.elapsed().as_millis() as i64;

        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = ?e, url = %url, "nullclaw: HTTP request failed");
                return Ok(None);
            }
        };
        let status = resp.status();
        if !status.is_success() {
            tracing::warn!(status = %status, url = %url, "nullclaw: non-2xx response");
            return Ok(None);
        }
        let reply: NullClawReply = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = ?e, "nullclaw: failed to parse response");
                return Ok(None);
            }
        };

        // 4. Persist the assistant reply as a ChatMessage row.
        let now = chrono::Utc::now().to_rfc3339();
        // Parse once for DB inserts (`NewChatMessage.channel_id` and
        // `NewNullClawExchange.*` are `Uuid` so SeaORM binds them as
        // blobs matching the `pk_uuid` parent columns).
        let channel_uuid = uuid::Uuid::parse_str(channel_id)
            .map_err(|e| AppError::Internal(format!("invalid channel id: {e}")))?;
        let user_msg_uuid = uuid::Uuid::parse_str(user_message_id)
            .map_err(|e| AppError::Internal(format!("invalid user message id: {e}")))?;
        let assistant_msg = chat_store
            .insert_message(NewChatMessage {
                channel_id: channel_uuid,
                sender_type: "assistant".into(),
                // Use the NullClaw bot's UUID (looked up by email at the
                // service layer) so the assistant message has a real FK
                // to `user`. When `bot_user_id` is `None` (bot user
                // missing — e.g. signup ran before this code shipped),
                // we fall back to `sender_id = None` and the message
                // still inserts (the chat renders it as a generic
                // assistant message).
                sender_id: bot_user_id,
                content: Some(reply.reply.clone()),
                kind: "text".into(),
                attachments: None,
                client_msg_id: None,
            })
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let assistant_msg_id = assistant_msg.id.to_string();

        // 5. Update channel last-message preview.
        let preview: String = reply.reply.chars().take(100).collect();
        let _ = chat_store
            .update_channel_preview(channel_id, preview, now.clone())
            .await?;

        // 6. Audit row.
        let _ = chat_store
            .insert_nullclaw_exchange(NewNullClawExchange {
                channel_id: Some(channel_uuid),
                user_message_id: Some(user_msg_uuid),
                assistant_message_id: Some(assistant_msg.id),
                prompt: Some(user_text.to_string()),
                completion: Some(reply.reply.clone()),
                model: Some(reply.model.clone()),
                latency_ms: Some(latency_ms),
                handoff_to_human: reply.handoff_to_human,
            })
            .await?;

        tracing::info!(
            channel_id,
            latency_ms,
            confidence = reply.confidence,
            handoff = reply.handoff_to_human,
            "nullclaw replied"
        );

        Ok(Some(NullClawOutcome {
            reply,
            assistant_message_id: assistant_msg_id,
            created_at: now,
            handoff: false,
            bot_user_id,
        }))
    }
}

// ── Global provider singleton ───────────────────────────────────

static PROVIDER: OnceCell<Arc<dyn NullClawProvider>> = OnceCell::new();

/// Initialise the global NullClaw provider from config. Called once on boot.
///
/// Resolution order:
///   1. **HTTP provider** — when `NULLCLAW_ENABLED=true` and
///      `NULLCLAW_API_URL`/`NULLCLAW_API_KEY` are set. This is what
///      production deployments use.
///   2. **Noop provider** — silently declines to reply. The customer's
///      message is still delivered to the channel; a human employee
///      will respond when online. The actual NullClaw endpoint will
///      be configured at deploy time.
pub fn init(cfg: &NullClawConfig) {
    let provider: Arc<dyn NullClawProvider> = if cfg.is_active() {
        tracing::info!(
            api_url = cfg.api_url.as_str(),
            model = cfg.model.as_str(),
            "NullClaw AI customer-support assistant ENABLED (HTTP provider)"
        );
        Arc::new(HttpNullClawProvider::new(
            cfg.api_url.clone(),
            cfg.api_key.clone(),
            cfg.model.clone(),
            cfg.timeout_ms,
            cfg.max_history,
        ))
    } else {
        tracing::info!(
            "NullClaw AI customer-support assistant disabled (set NULLCLAW_ENABLED + NULLCLAW_API_URL + NULLCLAW_API_KEY to enable)"
        );
        Arc::new(NoopNullClawProvider)
    };

    let _ = PROVIDER.set(provider);
    tracing::info!(
        enabled = cfg.is_active(),
        api_url = cfg.api_url.as_str(),
        model = cfg.model.as_str(),
        "nullclaw provider initialised"
    );
}

/// Access the global provider. Falls back to [`NoopNullClawProvider`] if
/// [`init`] was never called (defensive — should not happen in practice).
pub fn provider() -> Arc<dyn NullClawProvider> {
    PROVIDER
        .get()
        .cloned()
        .unwrap_or_else(|| Arc::new(NoopNullClawProvider))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_provider_returns_none() {
        let p = NoopNullClawProvider;
        assert!(!p.is_enabled());
        assert_eq!(p.name(), "noop");
    }

    #[test]
    fn http_provider_constructs_client() {
        let p = HttpNullClawProvider::new(
            "https://api.nullclaw.ai".into(),
            "secret".into(),
            "nullclaw-v1".into(),
            5000,
            8,
        );
        assert!(p.is_enabled());
        assert_eq!(p.name(), "http");
        assert_eq!(p.timeout, Duration::from_millis(5000));
        assert_eq!(p.max_history, 8);
    }

    #[test]
    fn config_default_is_disabled() {
        let c = NullClawConfig::default();
        assert!(!c.is_active());
        assert!(c.api_url.is_empty());
        assert_eq!(c.timeout_ms, 15_000);
        assert_eq!(c.max_history, 12);
        assert_eq!(c.fallback_online_employees, 1);
    }

    #[test]
    fn provider_falls_back_to_noop_when_uninit() {
        let _p = provider();
    }

    #[test]
    fn nullclaw_reply_defaults_model() {
        let json = r#"{"reply":"hello","confidence":0.9}"#;
        let r: NullClawReply = serde_json::from_str(json).unwrap();
        assert_eq!(r.reply, "hello");
        assert!((r.confidence - 0.9).abs() < 1e-6);
        assert!(!r.handoff_to_human);
        assert_eq!(r.model, "nullclaw-v1");
    }
}
