//! Chat service — business logic for chat channels, messages, and
//! the NullClaw AI assistant.
//!
//! ## Design
//!
//! - **All chat-store access goes through this service.** Route handlers
//!   and the WebSocket hub call `ChatService` methods, never the store
//!   directly. This is the clean-architecture rule: API layer → service
//!   layer → store layer.
//! - **Returns domain models** (`chat_channel::Model`,
//!   `chat_message::Model`), NOT JSON. The route layer maps to JSON DTOs.
//! - **NullClaw integration lives here.** The `maybe_nullclaw_reply`
//!   method wraps the provider trait so the WS handler doesn't need to
//!   touch the chat store directly.
//!
//! ## Why a service layer for chat
//!
//! The chat subsystem is shared between three transports:
//!   * REST routes (`/api/chat/*`) — list channels, post messages (WS
//!     fallback), mark read.
//!   * WebSocket hub (`/ws`) — real-time message broadcast + NullClaw
//!     AI hook.
//!   * NullClaw audit API (`/api/nullclaw/exchanges`) — list AI
//!     exchanges for the admin dashboard.
//!
//! Without a service layer, each transport would re-implement the same
//! "insert message + update preview + clear unread" sequence — and
//! the WS handler was already doing exactly that. Centralising the
//! logic here removes ~30 lines of duplicated store-access code from
//! the WS handler and makes the chat subsystem testable in isolation.

use std::sync::Arc;

use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::auth::SessionUser;
use crate::entity::{chat_channel, chat_message, null_claw_exchange};
use crate::error::{AppError, AppResult};
use crate::nullclaw::NULLCLAW_BOT_EMAIL;
use crate::store::chat::{NewChannelMember, NewChatMessage};
use crate::store::CompositeStore;

/// Chat service. Constructed once at startup with a shared
/// `Arc<CompositeStore>` and stored as `Arc<ChatService>` on
/// `AppState`.
pub struct ChatService {
    store: Arc<CompositeStore>,
    /// Cached lookup of the NullClaw bot user's UUID. Resolved lazily
    /// on first access via `resolve_bot_user_id()`. The bot user is
    /// created at first-user signup time (see `AuthService::register`)
    /// with a runtime-assigned UUID — so we can't hardcode it.
    ///
    /// `None` here means "lookup attempted, bot user not found". The
    /// chat code degrades gracefully in that case — `sender_id` falls
    /// back to `None` and the bot member row is skipped.
    bot_user_id: OnceCell<Option<Uuid>>,
    /// Cached lookup of the system admin's UUID (first non-bot
    /// employee). Resolved lazily on first access via
    /// `resolve_admin_employee_id()`. Used to auto-assign an admin
    /// to every new channel so the support queue has a human owner.
    admin_employee_id: OnceCell<Option<Uuid>>,
}

impl ChatService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self {
            store,
            bot_user_id: OnceCell::new(),
            admin_employee_id: OnceCell::new(),
        }
    }

    /// Look up the NullClaw bot user's UUID by its well-known email
    /// (`nullclaw_agent@example.com`). Cached for the process lifetime
    /// via `OnceCell` — the lookup runs at most once per boot.
    ///
    /// Returns `None` if the bot user doesn't exist (e.g. signup ran
    /// before this code shipped, or the bot user was deleted). Callers
    /// should handle `None` gracefully (skip the bot member row, use
    /// `sender_id = None` for AI replies).
    async fn resolve_bot_user_id(&self) -> Option<Uuid> {
        *self
            .bot_user_id
            .get_or_init(|| async {
                match self
                    .store
                    .user_store()
                    .get_user_by_email(NULLCLAW_BOT_EMAIL.to_string())
                    .await
                {
                    Ok(Some(bot)) => Some(bot.id),
                    Ok(None) => {
                        tracing::warn!(
                            email = NULLCLAW_BOT_EMAIL,
                            "NullClaw bot user not found — channel member row + AI sender_id will be skipped. Run signup to create the bot user."
                        );
                        None
                    }
                    Err(e) => {
                        tracing::warn!(
                            email = NULLCLAW_BOT_EMAIL,
                            error = %e,
                            "failed to look up NullClaw bot user — falling back to None"
                        );
                        None
                    }
                }
            })
            .await
    }

    /// Look up the system admin's UUID — the first non-bot user with
    /// role="employee". Cached for the process lifetime. Returns `None`
    /// if no admin exists (e.g. before first-user signup completes).
    async fn resolve_admin_employee_id(&self) -> Option<Uuid> {
        *self
            .admin_employee_id
            .get_or_init(|| async {
                match self.store.user_store().find_first_human_employee().await {
                    Ok(Some(admin)) => Some(admin.id),
                    Ok(None) => {
                        tracing::warn!(
                            "no human employee found — admin member row will be skipped. Run signup to create the first admin."
                        );
                        None
                    }
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            "failed to look up admin employee — falling back to None"
                        );
                        None
                    }
                }
            })
            .await
    }

    // ── Channels ────────────────────────────────────────────────

    /// List chat channels.
    ///
    /// - For **customers** (`is_employee == false`): returns only the
    ///   channels they started.
    /// - For **employees** (`is_employee == true`): returns ALL open
    ///   channels in the support queue (optionally filtered by their
    ///   brand). This is the admin support dashboard's view.
    pub async fn list_channels(
        &self,
        user_id: Uuid,
        is_employee: bool,
        brand_id: Option<Uuid>,
        limit: u64,
    ) -> AppResult<Vec<chat_channel::Model>> {
        let limit = limit.min(200);
        if is_employee {
            self.store
                .chat_store()
                .list_open_channels(brand_id, limit)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        } else {
            self.store
                .chat_store()
                .list_channels(user_id, limit)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))
        }
    }

    /// Create a new chat channel, OR return the user's existing OPEN
    /// channel if one already exists. This enforces the business rule:
    /// **a user has at most one open channel with support at a time.**
    /// Without this, every call to `POST /api/chat/channels` would
    /// create a duplicate, cluttering the admin dashboard with
    /// near-empty channels.
    ///
    /// `brand_id` matching: if the user passes a `brand_id`, we only
    /// reuse an existing open channel for that brand. If they pass
    /// `None` (general support), we reuse any open channel regardless
    /// of brand.
    pub async fn create_channel(
        &self,
        user_id: Uuid,
        brand_id: Option<Uuid>,
        topic: Option<String>,
    ) -> AppResult<chat_channel::Model> {
        // The `AuthUser` extractor only verifies the JWT signature — it
        // does NOT confirm the user still exists in the DB. The
        // `chat_channel` table has `fk_chatchannel_user` (ON DELETE
        // CASCADE), so inserting a row for a deleted user fails with a
        // FOREIGN KEY constraint error (SQLite code 787) that surfaces
        // as a 500. Verify the user exists first and return 401 for a
        // stale token instead.
        let user = self
            .store
            .user_store()
            .get_user(user_id)
            .await
            .map_err(|e| match e {
                crate::store::StoreError::NotFound(_) => AppError::Unauthorized(
                    "authentication token references a non-existent user".into(),
                ),
                other => AppError::Internal(other.to_string()),
            })?;
        let _ = user; // Just verifying existence.

        // `fk_chatchannel_brand` requires `brand_id` to reference an
        // existing brand. Validate it up front so an invalid id returns
        // 400 instead of a 500 FK error.
        if let Some(brand_id) = brand_id {
            let brand = self
                .store
                .brand_store()
                .get_by_id(brand_id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if brand.is_none() {
                return Err(AppError::Validation(format!("brand not found: {brand_id}")));
            }
        }

        // ── Enforce 1 open channel per user ──────────────────────
        // Check if the user already has an OPEN channel. If yes,
        // return it instead of creating a new one. This prevents
        // the "lots of channels" problem the user reported.
        let existing = self
            .store
            .chat_store()
            .list_channels(user_id, 50)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(open) = existing
            .into_iter()
            .find(|c| c.status == "open" && brand_id == c.brand_id)
        {
            // Reuse the existing open channel. The topic/brand_id
            // from the request body are ignored — the user's existing
            // channel keeps its original topic.
            return Ok(open);
        }

        let channel = self
            .store
            .chat_store()
            .create_channel(
                user_id,
                brand_id,
                topic.or_else(|| Some("Hỗ trợ".to_string())),
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // ── Auto-join members: customer + NullClaw bot + admin ──────
        //
        // On channel creation we add THREE membership rows:
        //   1. The customer (role="user") — the participant who started
        //      the conversation.
        //   2. The NullClaw bot (role="bot") — the AI assistant. The
        //      bot doesn't have a WS socket; this row is for roster /
        //      audit purposes.
        //   3. The admin employee (role="employee") — the first non-bot
        //      employee (i.e. the system admin who signed up first).
        //      This is the human responsible for the support queue.
        //
        // All three inserts are best-effort: a failure to add a member
        // row does NOT fail channel creation (the channel itself is
        // already persisted). We log + continue. Real-time routing
        // still works because the WS hub uses in-memory room membership
        // (set via the `join` WS message) — NOT the DB member table.
        // The DB table is for roster metadata + future "leave channel"
        // semantics.
        let channel_id_v4 = channel.id;

        // 1. Customer.
        if let Err(e) = self
            .store
            .chat_store()
            .add_channel_member(NewChannelMember {
                channel_id: channel_id_v4,
                user_id,
                role: "user".into(),
            })
            .await
        {
            tracing::warn!(
                channel_id = %channel_id_v4,
                user_id = %user_id,
                error = %e,
                "failed to add customer as channel member (continuing)"
            );
        }

        // 2. NullClaw bot (resolved by email — the bot user is created
        //    at first-user signup time, not by a migration seed).
        if let Some(bot_id) = self.resolve_bot_user_id().await {
            if let Err(e) = self
                .store
                .chat_store()
                .add_channel_member(NewChannelMember {
                    channel_id: channel_id_v4,
                    user_id: bot_id,
                    role: "bot".into(),
                })
                .await
            {
                tracing::warn!(
                    channel_id = %channel_id_v4,
                    bot_id = %bot_id,
                    error = %e,
                    "failed to add NullClaw bot as channel member (continuing)"
                );
            }
        }

        // 3. Admin employee — the first non-bot user with role="employee".
        //    This is the human admin who signed up first (created by
        //    `AuthService::register` before the NullClaw bot user).
        if let Some(admin_id) = self.resolve_admin_employee_id().await {
            if let Err(e) = self
                .store
                .chat_store()
                .add_channel_member(NewChannelMember {
                    channel_id: channel_id_v4,
                    user_id: admin_id,
                    role: "employee".into(),
                })
                .await
            {
                tracing::warn!(
                    channel_id = %channel_id_v4,
                    admin_id = %admin_id,
                    error = %e,
                    "failed to add admin as channel member (continuing)"
                );
            }
        }

        Ok(channel)
    }

    /// Check whether a channel exists (used by the WS `join` handler).
    pub async fn channel_exists(&self, channel_id: &str) -> AppResult<bool> {
        self.store
            .chat_store()
            .channel_exists(channel_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Fetch a channel by id (used by the NullClaw hook to get the
    /// `brand_id` for fallback-threshold counting).
    pub async fn get_channel(&self, channel_id: &str) -> AppResult<Option<chat_channel::Model>> {
        self.store
            .chat_store()
            .get_channel(channel_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    // ── Messages ───────────────────────────────────────────────

    /// List messages in a channel (paginated, newest first).
    pub async fn list_messages(
        &self,
        channel_id: &str,
        limit: u64,
        offset: u64,
    ) -> AppResult<Vec<chat_message::Model>> {
        self.store
            .chat_store()
            .list_messages(channel_id, limit.min(200), offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Insert a chat message + update the channel's last-message preview.
    /// Returns the stored message model.
    ///
    /// Used by the WS handler (real-time path) and the REST `post_message`
    /// fallback. Idempotent via `client_msg_id` — if a message with the
    /// same `client_msg_id` already exists, it's returned without
    /// re-inserting.
    pub async fn insert_message(&self, msg: NewChatMessage) -> AppResult<chat_message::Model> {
        let stored = self
            .store
            .chat_store()
            .insert_message(msg)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Best-effort: update the channel's last-message preview.
        let preview: String = stored
            .content
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(100)
            .collect();
        let now = stored.created_at.clone();
        let channel_id_str = stored.channel_id.to_string();
        let _ = self
            .store
            .chat_store()
            .update_channel_preview(&channel_id_str, preview, now)
            .await;

        Ok(stored)
    }

    /// Look up a message by its `client_msg_id` (idempotency check).
    pub async fn find_message_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> AppResult<Option<chat_message::Model>> {
        self.store
            .chat_store()
            .find_message_by_client_id(channel_id, client_msg_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Clear the unread counter for one side of a channel (`"user"` or
    /// `"employee"`). Used by the REST + WS `mark_read` paths.
    pub async fn clear_unread(&self, channel_id: &str, side: &str) -> AppResult<()> {
        self.store
            .chat_store()
            .clear_unread(channel_id, side)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    /// Increment the unread counter for one side of a channel
    /// (`"user"` or `"employee"`). Called when a message is inserted:
    ///   - Customer sends → `side="employee"` (admin's badge grows).
    ///   - Employee sends → `side="user"` (customer's badge grows).
    ///
    /// Best-effort — a failure here is logged + swallowed because the
    /// message itself was already persisted; the unread counter is
    /// secondary UX metadata.
    pub async fn increment_unread(&self, channel_id: &str, side: &str) -> AppResult<()> {
        self.store
            .chat_store()
            .increment_unread(channel_id, side)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    // ── NullClaw ────────────────────────────────────────────────

    /// Try to generate a NullClaw AI reply for a user message. Returns
    /// `Ok(Some(outcome))` if the AI replied (the caller broadcasts it),
    /// `Ok(None)` if NullClaw declined (humans online, disabled, etc.).
    ///
    /// This is the ONLY public entry point for NullClaw — the WS handler
    /// calls this instead of touching the chat store directly.
    #[allow(clippy::too_many_arguments)]
    pub async fn maybe_nullclaw_reply(
        &self,
        channel_id: &str,
        brand_id: Option<&str>,
        user: &SessionUser,
        user_message_id: &str,
        user_text: &str,
        online_employees: usize,
        fallback_threshold: usize,
    ) -> AppResult<Option<crate::nullclaw::NullClawOutcome>> {
        let provider = crate::nullclaw::provider();
        if !provider.is_enabled() {
            return Ok(None);
        }
        // Resolve the bot user's UUID (cached). Passed down to the
        // provider so it can set `sender_id` on the assistant message.
        let bot_user_id = self.resolve_bot_user_id().await;
        let chat_store = self.store.chat_store();
        provider
            .maybe_reply(
                chat_store.as_ref(),
                channel_id,
                brand_id,
                user,
                user_message_id,
                user_text,
                online_employees,
                fallback_threshold,
                bot_user_id,
            )
            .await
    }

    /// List NullClaw audit exchanges (admin dashboard).
    pub async fn list_nullclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> AppResult<Vec<null_claw_exchange::Model>> {
        self.store
            .chat_store()
            .list_nullclaw_exchanges(limit.min(200), offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Aggregate chat stats for the admin dashboard's top-row cards.
    ///
    /// Returns counts of channels grouped by status (open / assigned /
    /// closed / total) + the average first-response time in seconds.
    ///
    /// This is a server-side aggregate so the counts are accurate even
    /// when there are more channels than the channel list's page size
    /// (capped at 200). Without this, the "Đang chờ" card would max
    /// out at the list's page size.
    pub async fn chat_stats(&self) -> AppResult<crate::dto::chat::ChatStatsResponse> {
        let counts = self
            .store
            .chat_store()
            .count_channels_by_status()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut open_count: i64 = 0;
        let mut assigned_count: i64 = 0;
        let mut closed_count: i64 = 0;
        let mut total_channels: i64 = 0;
        for (status, count) in counts {
            total_channels += count;
            match status.as_str() {
                "open" => open_count = count,
                "assigned" => assigned_count = count,
                "closed" => closed_count = count,
                _ => {} // unknown status — counted in total but not a card
            }
        }

        let avg_response_time_secs = self
            .store
            .chat_store()
            .avg_first_response_time_secs()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(crate::dto::chat::ChatStatsResponse {
            open_count,
            assigned_count,
            closed_count,
            total_channels,
            avg_response_time_secs,
        })
    }

    /// Expose the DB connection for admin stats endpoints (e.g.
    /// `pg_stat_activity` queries in `/api/admin/system`). This is a
    /// narrow escape hatch for system-level queries that don't fit
    /// the domain-store pattern — route handlers should NOT use this
    /// for business logic, only for admin/observability queries.
    pub fn db_for_stats(&self) -> &sea_orm::DatabaseConnection {
        self.store.db()
    }

    // ── RBAC helpers (for chat-specific role checks) ────────────

    /// Determine whether a user is an employee (has any non-`"user"`
    /// role). Used by the chat routes to decide the "side" (user vs.
    /// employee) for `mark_read` and `post_message`.
    pub async fn is_employee(&self, user_id: Uuid) -> AppResult<bool> {
        let perms = self
            .store
            .rbac_store()
            .get_user_permissions(user_id)
            .await
            .map_err(|e| AppError::Internal(format!("failed to load user roles: {e}")))?;
        Ok(perms.role_names.iter().any(|r| r != "user"))
    }

    /// BOLA defense for chat: verify that `user_id` is authorized to
    /// access `channel_id`. Access is granted if the user is the channel
    /// owner (`channel.user_id == user_id`) OR the user is an employee
    /// (any non-`"user"` role — employees see the entire support queue).
    /// Returns the channel model on success so callers can also use it
    /// without an extra round-trip. Returns 404 (not 403) when the
    /// channel doesn't exist — this avoids leaking the existence of a
    /// channel the caller has no business knowing about (OWASP API1:2023).
    pub async fn assert_channel_access(
        &self,
        user_id: Uuid,
        channel_id: &str,
    ) -> AppResult<chat_channel::Model> {
        let channel = self
            .store
            .chat_store()
            .get_channel(channel_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("chat channel not found".into()))?;

        if channel.user_id == user_id {
            return Ok(channel);
        }
        if self.is_employee(user_id).await? {
            return Ok(channel);
        }
        // Don't reveal existence — return 404 to attackers.
        Err(AppError::NotFound("chat channel not found".into()))
    }
}

// `NewChatMessage` re-export so route handlers don't need to import
// from `crate::store::chat` directly — they can pull the DTO from
// the service layer.
pub use crate::store::chat::NewChatMessage as ChatMessageInput;
