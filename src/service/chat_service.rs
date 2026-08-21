//! Chat service — business logic for chat channels, messages, and
//! the ZeroClaw AI assistant.
//!
//! ## Design
//!
//! - **All chat-store access goes through this service.** Route handlers
//!   and the WebSocket hub call `ChatService` methods, never the store
//!   directly. This is the clean-architecture rule: API layer → service
//!   layer → store layer.
//! - **Returns domain models** (`chat_channel::Model`,
//!   `chat_message::Model`), NOT JSON. The route layer maps to JSON DTOs.
//! - **ZeroClaw integration lives here.** The `maybe_zeroclaw_reply`
//!   method wraps the provider trait so the WS handler doesn't need to
//!   touch the chat store directly.
//!
//! ## Why a service layer for chat
//!
//! The chat subsystem is shared between three transports:
//!   * REST routes (`/api/chat/*`) — list channels, post messages (WS
//!     fallback), mark read.
//!   * WebSocket hub (`/ws`) — real-time message broadcast + ZeroClaw
//!     AI hook.
//!   * ZeroClaw audit API (`/api/zeroclaw/exchanges`) — list AI
//!     exchanges for the admin dashboard.
//!
//! Without a service layer, each transport would re-implement the same
//! "insert message + update preview + clear unread" sequence — and
//! the WS handler was already doing exactly that. Centralising the
//! logic here removes ~30 lines of duplicated store-access code from
//! the WS handler and makes the chat subsystem testable in isolation.

use std::sync::Arc;

use uuid::Uuid;

use crate::auth::SessionUser;
use crate::entity::{chat_channel, chat_message, zero_claw_exchange};
use crate::error::{AppError, AppResult};
use crate::store::chat::NewChatMessage;
use crate::store::CompositeStore;

/// Chat service. Constructed once at startup with a shared
/// `Arc<CompositeStore>` and stored as `Arc<ChatService>` on
/// `AppState`.
pub struct ChatService {
    store: Arc<CompositeStore>,
}

impl ChatService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    // ── Channels ────────────────────────────────────────────────

    /// List chat channels for a user (their own + assigned-as-employee).
    pub async fn list_channels(
        &self,
        user_id: Uuid,
        limit: u64,
    ) -> AppResult<Vec<chat_channel::Model>> {
        self
            .store
            .chat_store()
            .list_channels(user_id, limit.min(200))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
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
                return Err(AppError::Validation(format!(
                    "brand not found: {brand_id}"
                )));
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

        self
            .store
            .chat_store()
            .create_channel(user_id, brand_id, topic.or_else(|| Some("Hỗ trợ".to_string())))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Check whether a channel exists (used by the WS `join` handler).
    pub async fn channel_exists(&self, channel_id: &str) -> AppResult<bool> {
        self
            .store
            .chat_store()
            .channel_exists(channel_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Fetch a channel by id (used by the ZeroClaw hook to get the
    /// `brand_id` for fallback-threshold counting).
    pub async fn get_channel(
        &self,
        channel_id: &str,
    ) -> AppResult<Option<chat_channel::Model>> {
        self
            .store
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
        self
            .store
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
    pub async fn insert_message(
        &self,
        msg: NewChatMessage,
    ) -> AppResult<chat_message::Model> {
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
        self
            .store
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

    // ── ZeroClaw ────────────────────────────────────────────────

    /// Try to generate a ZeroClaw AI reply for a user message. Returns
    /// `Ok(Some(outcome))` if the AI replied (the caller broadcasts it),
    /// `Ok(None)` if ZeroClaw declined (humans online, disabled, etc.).
    ///
    /// This is the ONLY public entry point for ZeroClaw — the WS handler
    /// calls this instead of touching the chat store directly.
    #[allow(clippy::too_many_arguments)]
    pub async fn maybe_zeroclaw_reply(
        &self,
        channel_id: &str,
        brand_id: Option<&str>,
        user: &SessionUser,
        user_message_id: &str,
        user_text: &str,
        online_employees: usize,
        fallback_threshold: usize,
    ) -> AppResult<Option<crate::zeroclaw::ZeroClawOutcome>> {
        let provider = crate::zeroclaw::provider();
        if !provider.is_enabled() {
            return Ok(None);
        }
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
            )
            .await
    }

    /// List ZeroClaw audit exchanges (admin dashboard).
    pub async fn list_zeroclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> AppResult<Vec<zero_claw_exchange::Model>> {
        self
            .store
            .chat_store()
            .list_zeroclaw_exchanges(limit.min(200), offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
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
}

// `NewChatMessage` re-export so route handlers don't need to import
// from `crate::store::chat` directly — they can pull the DTO from
// the service layer.
pub use crate::store::chat::NewChatMessage as ChatMessageInput;
