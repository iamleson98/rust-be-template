//! ZeroClaw AI customer-support assistant — integration harness.
//!
//! ## Purpose
//!
//! When a customer opens the support chat and no human agent is online (or
//! the queue is busy), ZeroClaw can reply on behalf of the brand. It learns
//! from the brand's data (FAQ, booking policies, route info) and answers
//! common questions instantly — like a domain-specific chatbot.
//!
//! ## Design
//!
//! This module defines a **provider trait** so the AI backend is pluggable:
//!
//!   * [`NoopZeroClawProvider`] — default. Always returns `None`, meaning
//!     "ZeroClaw not configured / let a human handle it". Zero overhead.
//!
//!   * [`HttpZeroClawProvider`] — calls an external ZeroClaw HTTP endpoint
//!     (set via `ZEROCLAW_API_URL` + `ZEROCLAW_API_KEY`).
//!
//! ## Hook point
//!
//! `ws/handler.rs::handle_message` calls [`ZeroClawProvider::maybe_reply`]
//! after a user message is broadcast. If the provider returns a reply, it's
//! inserted into `ChatMessage` with `senderType = 'assistant'` and broadcast
//! to the room. An entry is also written to `ZeroClawExchange` for audit
//! and future training.
//!
//! ## Adaptation notes
//!
//! Ported from `booking-rs/logic/zeroclaw`. The original used raw `sqlx`
//! against the `Pool`; this version takes a [`ChatStore`] trait object so
//! it fits the template's layered store architecture (no DB access in the
//! service/provider layer).

use async_trait::async_trait;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;

use crate::auth::SessionUser;
use crate::config::ZeroClawConfig;
use crate::error::AppError;
use crate::store::chat::{ChatStore, NewChatMessage, NewZeroClawExchange};

/// Conversation turn sent to ZeroClaw. `role` ∈ {`user`, `assistant`}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub role: String,
    pub text: String,
}

/// Request body sent to ZeroClaw.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZeroClawRequest {
    pub channel_id: String,
    pub brand_id: Option<String>,
    pub user_id: String,
    pub user_name: String,
    pub conversation: Vec<ConversationTurn>,
    pub locale: String,
}

/// Reply from ZeroClaw.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZeroClawReply {
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
    "zeroclaw-v1".into()
}

/// Outcome of a `maybe_reply` call.
#[derive(Debug, Clone)]
pub struct ZeroClawOutcome {
    pub reply: ZeroClawReply,
    /// ID of the `ChatMessage` row we inserted (senderType='assistant').
    pub assistant_message_id: String,
    /// ISO timestamp of the assistant message.
    pub created_at: String,
    /// True if the provider flagged `handoff_to_human`.
    pub handoff: bool,
}

/// Pluggable ZeroClaw provider. The default is [`NoopZeroClawProvider`];
/// when `ZEROCLAW_ENABLED=true` + `ZEROCLAW_API_URL` is set, the boot code
/// swaps in [`HttpZeroClawProvider`].
#[async_trait]
pub trait ZeroClawProvider: Send + Sync {
    /// Return the provider's display name (for logging + /api/zeroclaw/status).
    fn name(&self) -> &'static str;

    /// True if this provider is configured to actually call ZeroClaw.
    fn is_enabled(&self) -> bool;

    /// Try to generate a reply for the given conversation.
    ///
    /// Returns:
    ///   * `Ok(Some(outcome))` — ZeroClaw replied; caller broadcasts it.
    ///   * `Ok(None)` — ZeroClaw declined (low confidence, not enabled,
    ///     online employees available, etc.). Caller does nothing.
    ///   * `Err(_)` — store error. Caller logs and does nothing (the
    ///     customer's original message is still delivered; we never fail
    ///     the chat because ZeroClaw errored).
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
    ) -> Result<Option<ZeroClawOutcome>, AppError>;
}

// ── Noop provider (default — ZeroClaw disabled) ────────────────
//
// The default provider when no external ZeroClaw HTTP endpoint is
// configured. Always returns `None` — the customer's message is
// still delivered, but no AI reply is generated. A human employee
// (when online) will respond.
//
// At deploy time, set `ZEROCLAW_ENABLED=true` + `ZEROCLAW_API_URL` +
// `ZEROCLAW_API_KEY` to switch to [`HttpZeroClawProvider`], which
// calls the actual ZeroClaw LLM endpoint.

pub struct NoopZeroClawProvider;

#[async_trait]
impl ZeroClawProvider for NoopZeroClawProvider {
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
    ) -> Result<Option<ZeroClawOutcome>, AppError> {
        Ok(None)
    }
}

// ── HTTP provider ───────────────────────────────────────────────

pub struct HttpZeroClawProvider {
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub timeout: Duration,
    pub max_history: usize,
    pub client: reqwest::Client,
}

impl HttpZeroClawProvider {
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
impl ZeroClawProvider for HttpZeroClawProvider {
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
    ) -> Result<Option<ZeroClawOutcome>, AppError> {
        // 1. If humans are available, let them handle it.
        if online_employees >= fallback_threshold {
            tracing::debug!(
                channel_id,
                online_employees,
                fallback_threshold,
                "zeroclaw: skipping — humans online"
            );
            return Ok(None);
        }

        // 2. Fetch recent conversation history (last N messages).
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

        let req_body = ZeroClawRequest {
            channel_id: channel_id.to_string(),
            brand_id: brand_id.map(|s| s.to_string()),
            user_id: user.id.clone(),
            user_name: user.name.clone(),
            locale: "vi".into(),
            conversation,
        };

        // 3. Call ZeroClaw.
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
                tracing::warn!(error = ?e, url = %url, "zeroclaw: HTTP request failed");
                return Ok(None);
            }
        };
        let status = resp.status();
        if !status.is_success() {
            tracing::warn!(status = %status, url = %url, "zeroclaw: non-2xx response");
            return Ok(None);
        }
        let reply: ZeroClawReply = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = ?e, "zeroclaw: failed to parse response");
                return Ok(None);
            }
        };

        // 4. Persist the assistant reply as a ChatMessage row.
        let now = chrono::Utc::now().to_rfc3339();
        let assistant_msg = chat_store
            .insert_message(NewChatMessage {
                channel_id: channel_id.to_string(),
                sender_type: "assistant".into(),
                sender_id: Some(format!("zeroclaw:{}", self.model)),
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
            .await;

        // 6. Audit row.
        let _ = chat_store
            .insert_zeroclaw_exchange(NewZeroClawExchange {
                channel_id: Some(channel_id.to_string()),
                user_message_id: Some(user_message_id.to_string()),
                assistant_message_id: Some(assistant_msg_id.clone()),
                prompt: Some(user_text.to_string()),
                completion: Some(reply.reply.clone()),
                model: Some(reply.model.clone()),
                latency_ms: Some(latency_ms),
                handoff_to_human: reply.handoff_to_human,
            })
            .await;

        tracing::info!(
            channel_id,
            latency_ms,
            confidence = reply.confidence,
            handoff = reply.handoff_to_human,
            "zeroclaw replied"
        );

        Ok(Some(ZeroClawOutcome {
            reply,
            assistant_message_id: assistant_msg_id,
            created_at: now,
            handoff: false,
        }))
    }
}

// ── Global provider singleton ───────────────────────────────────

static PROVIDER: OnceCell<Arc<dyn ZeroClawProvider>> = OnceCell::new();

/// Initialise the global ZeroClaw provider from config. Called once on boot.
///
/// Resolution order:
///   1. **HTTP provider** — when `ZEROCLAW_ENABLED=true` and
///      `ZEROCLAW_API_URL`/`ZEROCLAW_API_KEY` are set. This is what
///      production deployments use.
///   2. **Noop provider** — silently declines to reply. The customer's
///      message is still delivered to the channel; a human employee
///      will respond when online. The actual ZeroClaw endpoint will
///      be configured at deploy time.
pub fn init(cfg: &ZeroClawConfig) {
    let provider: Arc<dyn ZeroClawProvider> = if cfg.is_active() {
        tracing::info!(
            api_url = cfg.api_url.as_str(),
            model = cfg.model.as_str(),
            "ZeroClaw AI customer-support assistant ENABLED (HTTP provider)"
        );
        Arc::new(HttpZeroClawProvider::new(
            cfg.api_url.clone(),
            cfg.api_key.clone(),
            cfg.model.clone(),
            cfg.timeout_ms,
            cfg.max_history,
        ))
    } else {
        tracing::info!(
            "ZeroClaw AI customer-support assistant disabled (set ZEROCLAW_ENABLED + ZEROCLAW_API_URL + ZEROCLAW_API_KEY to enable)"
        );
        Arc::new(NoopZeroClawProvider)
    };

    let _ = PROVIDER.set(provider);
    tracing::info!(
        enabled = cfg.is_active(),
        api_url = cfg.api_url.as_str(),
        model = cfg.model.as_str(),
        "zeroclaw provider initialised"
    );
}

/// Access the global provider. Falls back to [`NoopZeroClawProvider`] if
/// [`init`] was never called (defensive — should not happen in practice).
pub fn provider() -> Arc<dyn ZeroClawProvider> {
    PROVIDER
        .get()
        .cloned()
        .unwrap_or_else(|| Arc::new(NoopZeroClawProvider))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_provider_returns_none() {
        let p = NoopZeroClawProvider;
        assert!(!p.is_enabled());
        assert_eq!(p.name(), "noop");
    }

    #[test]
    fn http_provider_constructs_client() {
        let p = HttpZeroClawProvider::new(
            "https://api.zeroclaw.ai".into(),
            "secret".into(),
            "zeroclaw-v1".into(),
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
        let c = ZeroClawConfig::default();
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
    fn zeroclaw_reply_defaults_model() {
        let json = r#"{"reply":"hello","confidence":0.9}"#;
        let r: ZeroClawReply = serde_json::from_str(json).unwrap();
        assert_eq!(r.reply, "hello");
        assert!((r.confidence - 0.9).abs() < 1e-6);
        assert!(!r.handoff_to_human);
        assert_eq!(r.model, "zeroclaw-v1");
    }
}
