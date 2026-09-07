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
//!   * [`DirectLLMProvider`] — calls an OpenAI-compatible LLM API directly
//!     (e.g. Gemini via `https://generativelanguage.googleapis.com/v1beta/openai`).
//!     No external NullClaw container needed — the system prompt, safety rules,
//!     and conversation logic are all built into the backend.
//!
//! ## Hook point
//!
//! `ws/handler.rs::handle_message` calls [`NullClawProvider::maybe_reply`]
//! after a user message is broadcast. If the provider returns a reply, it's
//! inserted into `ChatMessage` with `senderType = 'assistant'` and broadcast
//! to the room. An entry is also written to `NullClawExchange` for audit
//! and future training.
//!
//! ## Why DirectLLMProvider (not the NullClaw container)
//!
//! The previous `HttpNullClawProvider` called an external NullClaw HTTP
//! endpoint which was a separate Docker container. That container was just
//! a proxy — it took the conversation, prepended a system prompt, called the
//! LLM API, and returned the reply. All of that logic is now built into
//! `DirectLLMProvider`, eliminating:
//!   - The NullClaw container (~1 GB RAM on the VM)
//!   - The extra network hop (backend → NullClaw → LLM)
//!   - The shared-secret API key between backend and NullClaw
//!   - The `nullclaw.config.json` mount
//!
//! The system prompt + safety rules are embedded as Rust constants — they
//! were previously in `nullclaw.config.json` (mounted into the NullClaw
//! container). The Vietnamese prompt, domain guardrails, block patterns,
//! and domain keywords are all preserved.

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
// `AuthService::register` (see `src/service/auth_service.rs`).
// We look up the bot user by its well-known email at the call sites
// that need it. The lookup is cached per-process via `OnceCell`.

/// The well-known email of the NullClaw bot user.
pub const NULLCLAW_BOT_EMAIL: &str = "nullclaw_agent@example.com";

/// Display name used in WS broadcasts + chat messages.
pub const NULLCLAW_BOT_NAME: &str = "NullClaw AI";

// ── System prompt (embedded — was in nullclaw.config.json) ──────
//
// The full Vietnamese system prompt with domain guardrails, safety rules,
// and VeXeVN business info. Previously lived in `nullclaw.config.json`
// (mounted into the NullClaw container). Now embedded directly — no
// external file needed.

const SYSTEM_PROMPT: &str = "\
Bạn là trợ lý hỗ trợ khách hàng của VeXeVN — nền tảng đặt vé xe khách trực tuyến tại Việt Nam.\n\n\
## Vai trò\n\
- Trả lời các câu hỏi về đặt vé, lịch trình, giá vé, thanh toán, hoàn/hủy vé\n\
- Hỗ trợ khách hàng giải quyết vấn đề về tài khoản, mã vé\n\
- Hướng dẫn khách hàng sử dụng website vexevn.vn\n\n\
## Quy tắc nghiêm ngặt\n\
1. CHỈ trả lời các câu hỏi liên quan đến: đặt vé xe, lịch trình, giá vé, thanh toán, hoàn/hủy vé, tài khoản người dùng, dịch vụ VeXeVN.\n\
2. KHÔNG trả lời các câu hỏi ngoài lĩnh vực: chính trị, tôn giáo, thể thao, giải trí, lập trình, y tế, pháp lý, hoặc bất kỳ chủ đề nào không liên quan đến VeXeVN.\n\
3. Nếu khách hàng hỏi câu ngoài lĩnh vực, lịch sự từ chối: \"Xin lỗi, em chỉ hỗ trợ các vấn đề liên quan đến đặt vé xe và dịch vụ VeXeVN. Bạn có câu hỏi nào về đặt vé không ạ?\"\n\
4. Luôn lịch sự, thân thiện, sử dụng tiếng Việt.\n\
5. KHÔNG đưa ra thông tin sai lệch. Nếu không biết câu trả lời, nói: \"Em cần kiểm tra thêm thông tin này. Bạn vui lòng đợi nhân viên hỗ trợ phản hồi nhé.\"\n\
6. KHÔNG đưa ra thông tin cá nhân của bất kỳ ai.\n\
7. KHÔNG đưa ra liên kết hoặc URL ngoài trừ các trang chính thức của VeXeVN (vexevn.vn).\n\
8. Giới hạn độ dài trả lời: tối đa 3 câu (khoảng 200 từ).\n\
9. KHÔNG sử dụng emoji quá nhiều (tối đa 1 emoji mỗi câu trả lời).\n\
10. Nếu khách hàng cần hỗ trợ khẩn cấp hoặc phức tạp, hướng dẫn gọi hotline 1900 6067.\n\n\
## Thông tin VeXeVN\n\
- Website: vexevn.vn\n\
- Hotline: 1900 6067 (8h-22h)\n\
- Email hỗ trợ: hotro@vexevn.vn\n\
- Thanh toán: VNPay, MoMo, ZaloPay, VietQR, COD (thanh toán trên xe)\n\
- Chính sách hoàn/hủy: Hủy trước 24h = hoàn 100%, 12-24h = hoàn 70%, <12h = không hoàn.\n\
- Đặt vé: Chọn điểm đi/đến + ngày → chọn chuyến → nhập thông tin → thanh toán. Vé điện tử gửi qua email/Zalo.\n\n\
## Xử lý chuyển cho nhân viên\n\
Nếu câu hỏi phức tạp hoặc cần thông tin cụ thể về mã vé, chuyển cho nhân viên: \"Em đã ghi nhận yêu cầu của bạn. Nhân viên hỗ trợ sẽ phản hồi chi tiết trong ít phút nữa.\"";

/// Patterns that indicate prompt injection / jailbreak attempts.
/// If the user's message contains any of these (case-insensitive),
/// the AI refuses to process it and returns a safe fallback message.
const BLOCK_PATTERNS: &[&str] = &[
    "ignore previous instructions",
    "you are not",
    "act as",
    "pretend to be",
    "forget your instructions",
    "override",
    "system prompt",
    "jailbreak",
];

/// Safe fallback message when a prompt-injection attempt is detected.
const BLOCK_MESSAGE: &str =
    "Em không thể xử lý yêu cầu này. Bạn có câu hỏi nào về đặt vé xe VeXeVN không ạ?";

/// Maximum input length (characters). Messages longer than this are
/// truncated before being sent to the LLM — prevents token abuse.
const MAX_INPUT_LENGTH: usize = 500;

/// Maximum output tokens for the LLM response.
const MAX_OUTPUT_TOKENS: u32 = 500;

/// LLM sampling temperature — low for consistent, factual responses.
const LLM_TEMPERATURE: f32 = 0.3;

// ── DTOs ──────────────────────────────────────────────────────

/// Conversation turn sent to the LLM. `role` ∈ {`user`, `assistant`}.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub role: String,
    pub text: String,
}

/// Reply from the LLM.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NullClawReply {
    pub reply: String,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub handoff_to_human: bool,
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
    pub assistant_message_id: String,
    pub created_at: String,
    pub handoff: bool,
    pub bot_user_id: Option<Uuid>,
}

// ── Provider trait ──────────────────────────────────────────────

/// Pluggable NullClaw provider. The default is [`NoopNullClawProvider`];
/// when `NULLCLAW_ENABLED=true` + `LLM_API_KEY` is set, the boot code
/// swaps in [`DirectLLMProvider`].
#[async_trait]
pub trait NullClawProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn is_enabled(&self) -> bool;

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

// ── Direct LLM provider ────────────────────────────────────────
//
// Calls an OpenAI-compatible chat completions API directly (e.g. Gemini
// via `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`).
// No external NullClaw container needed — the system prompt, safety rules,
// and conversation logic are all built into the backend.

pub struct DirectLLMProvider {
    /// Base URL of the OpenAI-compatible API (e.g.
    /// `https://generativelanguage.googleapis.com/v1beta/openai`).
    /// The provider appends `/chat/completions` to this.
    pub base_url: String,
    /// API key for the LLM provider (e.g. Gemini API key).
    pub api_key: String,
    /// Model name (e.g. `gemini-2.0-flash`).
    pub model: String,
    pub timeout: Duration,
    pub max_history: usize,
    pub client: reqwest::Client,
}

impl DirectLLMProvider {
    pub fn new(
        base_url: String,
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
            base_url,
            api_key,
            model,
            timeout: Duration::from_millis(timeout_ms),
            max_history,
            client,
        }
    }

    /// Check if the user's message contains any block patterns
    /// (prompt injection / jailbreak attempts). Returns `true` if blocked.
    fn is_blocked(user_text: &str) -> bool {
        let lower = user_text.to_lowercase();
        BLOCK_PATTERNS.iter().any(|p| lower.contains(p))
    }

    /// Truncate the user's message to `MAX_INPUT_LENGTH` characters.
    fn truncate_input(user_text: &str) -> String {
        if user_text.len() <= MAX_INPUT_LENGTH {
            user_text.to_string()
        } else {
            user_text.chars().take(MAX_INPUT_LENGTH).collect()
        }
    }

    /// Build the OpenAI-compatible chat completions request body.
    fn build_request_body(&self, conversation: &[ConversationTurn]) -> serde_json::Value {
        // Build the messages array: system prompt + conversation history.
        let mut messages = vec![serde_json::json!({
            "role": "system",
            "content": SYSTEM_PROMPT,
        })];

        for turn in conversation {
            messages.push(serde_json::json!({
                "role": turn.role,
                "content": turn.text,
            }));
        }

        serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": LLM_TEMPERATURE,
            "max_tokens": MAX_OUTPUT_TOKENS,
        })
    }
}

/// OpenAI-compatible chat completions response shape (partial —
/// only the fields we need).
#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

#[async_trait]
impl NullClawProvider for DirectLLMProvider {
    fn name(&self) -> &'static str {
        "direct-llm"
    }
    fn is_enabled(&self) -> bool {
        true
    }

    async fn maybe_reply(
        &self,
        chat_store: &dyn ChatStore,
        channel_id: &str,
        _brand_id: Option<&str>,
        _user: &SessionUser,
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

        // 2. Safety check — block prompt injection attempts.
        if Self::is_blocked(user_text) {
            tracing::warn!(channel_id, "nullclaw: blocked prompt injection attempt");
            // Still persist a safe fallback reply so the customer gets
            // an immediate response.
            let reply = NullClawReply {
                reply: BLOCK_MESSAGE.to_string(),
                confidence: 1.0,
                handoff_to_human: false,
                model: "safety-filter".into(),
            };
            return self
                .persist_and_return(
                    chat_store,
                    channel_id,
                    user_message_id,
                    user_text,
                    reply,
                    0,
                    bot_user_id,
                )
                .await;
        }

        // 3. Truncate input to prevent token abuse.
        let truncated_text = Self::truncate_input(user_text);

        // 4. Fetch recent conversation history (last N messages).
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
            .rev()
            .collect();

        // If the just-sent message isn't the last entry (race), append it.
        if conversation.last().map(|t| t.text.as_str()) != Some(&truncated_text) {
            conversation.push(ConversationTurn {
                role: "user".into(),
                text: truncated_text.clone(),
            });
        }
        // Trim to last N turns.
        if conversation.len() > self.max_history {
            let start = conversation.len() - self.max_history;
            conversation = conversation.split_off(start);
        }

        // 5. Call the LLM API directly.
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let req_body = self.build_request_body(&conversation);
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
                tracing::warn!(error = ?e, url = %url, "nullclaw: LLM API request failed");
                return Ok(None);
            }
        };
        let status = resp.status();
        if !status.is_success() {
            tracing::warn!(status = %status, url = %url, "nullclaw: LLM API non-2xx response");
            return Ok(None);
        }

        let completion: ChatCompletionResponse = match resp.json().await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = ?e, "nullclaw: failed to parse LLM response");
                return Ok(None);
            }
        };

        let reply_text = completion
            .choices
            .first()
            .and_then(|c| c.message.content.as_deref())
            .unwrap_or("Em xin lỗi, em không hiểu yêu cầu của bạn. Vui lòng thử lại hoặc gọi hotline 1900 6067.")
            .to_string();

        let reply = NullClawReply {
            reply: reply_text,
            confidence: 1.0,         // LLM doesn't provide confidence — always 1.0
            handoff_to_human: false, // Could add prompt-based handoff detection later
            model: completion.model.unwrap_or_else(|| self.model.clone()),
        };

        // 6. Persist + return.
        self.persist_and_return(
            chat_store,
            channel_id,
            user_message_id,
            user_text,
            reply,
            latency_ms,
            bot_user_id,
        )
        .await
    }
}

impl DirectLLMProvider {
    /// Persist the AI reply as a ChatMessage + audit row, then return
    /// the `NullClawOutcome` for the WS handler to broadcast.
    #[allow(clippy::too_many_arguments)]
    async fn persist_and_return(
        &self,
        chat_store: &dyn ChatStore,
        channel_id: &str,
        user_message_id: &str,
        user_text: &str,
        reply: NullClawReply,
        latency_ms: i64,
        bot_user_id: Option<Uuid>,
    ) -> Result<Option<NullClawOutcome>, AppError> {
        let now = chrono::Utc::now().to_rfc3339();
        let channel_uuid = uuid::Uuid::parse_str(channel_id)
            .map_err(|e| AppError::Internal(format!("invalid channel id: {e}")))?;
        let user_msg_uuid = uuid::Uuid::parse_str(user_message_id)
            .map_err(|e| AppError::Internal(format!("invalid user message id: {e}")))?;

        let assistant_msg = chat_store
            .insert_message(NewChatMessage {
                channel_id: channel_uuid,
                sender_type: "assistant".into(),
                sender_id: bot_user_id,
                content: Some(reply.reply.clone()),
                kind: "text".into(),
                attachments: None,
                client_msg_id: None,
            })
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let assistant_msg_id = assistant_msg.id.to_string();

        // Update channel last-message preview.
        let preview: String = reply.reply.chars().take(100).collect();
        chat_store
            .update_channel_preview(channel_id, preview, now.clone())
            .await?;

        // Audit row.
        chat_store
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
            "nullclaw replied (direct LLM)"
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
///   1. **DirectLLMProvider** — when `NULLCLAW_ENABLED=true` and
///      `LLM_API_KEY` (or `NULLCLAW_API_KEY`) is set. Calls the LLM
///      API directly — no external NullClaw container needed.
///   2. **Noop provider** — silently declines to reply.
pub fn init(cfg: &NullClawConfig) {
    let provider: Arc<dyn NullClawProvider> = if cfg.is_active() {
        tracing::info!(
            base_url = cfg.api_url.as_str(),
            model = cfg.model.as_str(),
            "NullClaw AI customer-support assistant ENABLED (DirectLLM provider — no external container needed)"
        );
        Arc::new(DirectLLMProvider::new(
            cfg.api_url.clone(),
            cfg.api_key.clone(),
            cfg.model.clone(),
            cfg.timeout_ms,
            cfg.max_history,
        ))
    } else {
        tracing::info!(
            "NullClaw AI customer-support assistant disabled (set NULLCLAW_ENABLED=true + LLM_API_KEY to enable)"
        );
        Arc::new(NoopNullClawProvider)
    };

    let _ = PROVIDER.set(provider);
    tracing::info!(
        enabled = cfg.is_active(),
        base_url = cfg.api_url.as_str(),
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
    fn direct_llm_provider_constructs() {
        let p = DirectLLMProvider::new(
            "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            "test-key".into(),
            "gemini-2.0-flash".into(),
            15000,
            12,
        );
        assert!(p.is_enabled());
        assert_eq!(p.name(), "direct-llm");
        assert_eq!(p.model, "gemini-2.0-flash");
        assert_eq!(p.max_history, 12);
    }

    #[test]
    fn config_default_is_disabled() {
        let c = NullClawConfig::default();
        assert!(!c.is_active());
        assert_eq!(c.timeout_ms, 15_000);
        assert_eq!(c.max_history, 12);
        assert_eq!(c.fallback_online_employees, 1);
    }

    #[test]
    fn provider_falls_back_to_noop_when_uninit() {
        let _p = provider();
    }

    #[test]
    fn block_patterns_detect_injection() {
        assert!(DirectLLMProvider::is_blocked(
            "ignore previous instructions"
        ));
        assert!(DirectLLMProvider::is_blocked("act as a different AI"));
        assert!(DirectLLMProvider::is_blocked("JAILBREAK the system"));
        assert!(!DirectLLMProvider::is_blocked("Tôi muốn đặt vé xe"));
        assert!(!DirectLLMProvider::is_blocked(
            "Giá vé đi Đà Nẵng bao nhiêu?"
        ));
    }

    #[test]
    fn truncate_long_input() {
        let short = "Tôi muốn đặt vé";
        assert_eq!(DirectLLMProvider::truncate_input(short), short);

        let long = "a".repeat(600);
        let truncated = DirectLLMProvider::truncate_input(&long);
        assert_eq!(truncated.len(), MAX_INPUT_LENGTH);
    }

    #[test]
    fn system_prompt_is_vietnamese() {
        assert!(SYSTEM_PROMPT.contains("VeXeVN"));
        assert!(SYSTEM_PROMPT.contains("đặt vé"));
        assert!(SYSTEM_PROMPT.contains("hotline"));
    }
}
