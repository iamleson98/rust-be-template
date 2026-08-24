//! Chat store — read/write access to chat channels, messages, and
//! ZeroClaw audit exchanges. Used by the WebSocket chat hub and the
//! ZeroClaw AI assistant.
//!
//! Follows the template's store pattern: `ChatStore` trait +
//! `DbChatStore` (`#[retry]`) + `CacheChatStore<S>` wrapper.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::{chat_channel, chat_channel_member, chat_message, zero_claw_exchange};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  New-row DTOs
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct NewChatMessage {
    pub channel_id: Uuid,
    pub sender_type: String,
    pub sender_id: Option<Uuid>,
    pub content: Option<String>,
    pub kind: String,
    pub attachments: Option<String>,
    pub client_msg_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewZeroClawExchange {
    pub channel_id: Option<Uuid>,
    pub user_message_id: Option<Uuid>,
    pub assistant_message_id: Option<Uuid>,
    pub prompt: Option<String>,
    pub completion: Option<String>,
    pub model: Option<String>,
    pub latency_ms: Option<i64>,
    pub handoff_to_human: bool,
}

#[derive(Debug, Clone)]
pub struct NewChannelMember {
    pub channel_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait ChatStore: Send + Sync {
    async fn channel_exists(&self, channel_id: &str) -> StoreResult<bool>;
    async fn get_channel(&self, channel_id: &str) -> StoreResult<Option<chat_channel::Model>>;
    /// List channels owned by a customer (channels they started).
    /// Used by the customer-facing chat widget.
    async fn list_channels(
        &self,
        user_id: Uuid,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>>;
    /// List all OPEN channels — the employee support queue.
    /// Optionally filtered by brand. Used by the admin chat dashboard
    /// so all support staff see the same queue.
    async fn list_open_channels(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>>;
    async fn create_channel(
        &self,
        user_id: Uuid,
        brand_id: Option<Uuid>,
        topic: Option<String>,
    ) -> StoreResult<chat_channel::Model>;
    async fn update_channel_preview(
        &self,
        channel_id: &str,
        preview: String,
        at: String,
    ) -> StoreResult<()>;
    async fn list_messages(
        &self,
        channel_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_message::Model>>;
    async fn insert_message(&self, msg: NewChatMessage) -> StoreResult<chat_message::Model>;
    async fn message_exists_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> StoreResult<bool>;
    /// Fetch the stored message for a given `client_msg_id` — replaces the
    /// previous pattern of `message_exists_by_client_id(...)` →
    /// `list_messages(100).find(client_msg_id)` (O(100) linear scan on every
    /// duplicate POST). Single SQL round-trip.
    async fn find_message_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> StoreResult<Option<chat_message::Model>>;
    async fn insert_zeroclaw_exchange(&self, ex: NewZeroClawExchange) -> StoreResult<()>;
    async fn list_zeroclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<zero_claw_exchange::Model>>;
    /// Clear the unread counter for one side of a channel (`"user"` or
    /// `"employee"`). Best-effort — returns `Ok(())` if the channel is gone.
    async fn clear_unread(&self, channel_id: &str, side: &str) -> StoreResult<()>;
    /// Increment the unread counter for one side of a channel
    /// (`"user"` or `"employee"`). Used when a message is inserted:
    ///   - Customer sends → increment `unread_employee` (admin's badge).
    ///   - Employee sends → increment `unread_user` (customer's badge).
    /// Best-effort — returns `Ok(())` if the channel is gone (the
    /// message itself was already persisted; the unread counter is
    /// secondary UX metadata).
    async fn increment_unread(&self, channel_id: &str, side: &str) -> StoreResult<()>;

    // ── Channel members ─────────────────────────────────────────
    //
    // Membership rows are written when a channel is created:
    //   - the customer (role="user")
    //   - the ZeroClaw bot (role="bot")
    //
    // Employees don't get explicit member rows — they see all open
    // channels in their brand via `list_open_channels`. This avoids
    // N×M membership explosion (every channel × every employee).

    /// Add a member to a channel. Idempotent — uses INSERT OR IGNORE
    /// semantics via the unique(channel_id, user_id) index. Returns
    /// `Ok(())` even if the member already exists.
    async fn add_channel_member(&self, member: NewChannelMember) -> StoreResult<()>;
    /// List all members of a channel (active = `left_at IS NULL`).
    async fn list_channel_members(
        &self,
        channel_id: &str,
    ) -> StoreResult<Vec<chat_channel_member::Model>>;
    async fn invalidate(&self, channel_id: Option<&str>);
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbChatStore {
    db: Arc<DatabaseConnection>,
}

impl DbChatStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbChatStore {}

#[async_trait]
#[retry]
impl ChatStore for DbChatStore {
    async fn channel_exists(&self, channel_id: &str) -> StoreResult<bool> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        Ok(chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?
            .is_some())
    }

    async fn get_channel(&self, channel_id: &str) -> StoreResult<Option<chat_channel::Model>> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        Ok(chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_channels(
        &self,
        user_id: Uuid,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        Ok(chat_channel::Entity::find()
            .filter(chat_channel::Column::UserId.eq(user_id))
            .order_by_desc(chat_channel::Column::LastMessageAt)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_open_channels(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        let mut q = chat_channel::Entity::find()
            .filter(chat_channel::Column::Status.eq("open"))
            .order_by_desc(chat_channel::Column::LastMessageAt)
            .limit(limit);
        if let Some(brand_id) = brand_id {
            q = q.filter(chat_channel::Column::BrandId.eq(brand_id));
        }
        Ok(q.all(self.db.as_ref()).await?)
    }

    #[store_macros::no_retry]
    async fn create_channel(
        &self,
        user_id: Uuid,
        brand_id: Option<Uuid>,
        topic: Option<String>,
    ) -> StoreResult<chat_channel::Model> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let brand_id_clone = brand_id;
        let topic_clone = topic.clone();
        let model = chat_channel::ActiveModel {
            id: Set(id),
            user_id: Set(user_id),
            brand_id: Set(brand_id),
            topic: Set(topic),
            status: Set("open".into()),
            priority: Set("normal".into()),
            last_message_at: Set(None),
            last_message_preview: Set(None),
            unread_user: Set(0),
            unread_employee: Set(0),
            created_at: Set(now.clone()),
            closed_at: Set(None),
        };
        chat_channel::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(chat_channel::Model {
            id,
            user_id,
            brand_id: brand_id_clone,
            topic: topic_clone,
            status: "open".into(),
            priority: "normal".into(),
            last_message_at: None,
            last_message_preview: None,
            unread_user: 0,
            unread_employee: 0,
            created_at: now,
            closed_at: None,
        })
    }

    async fn update_channel_preview(
        &self,
        channel_id: &str,
        preview: String,
        at: String,
    ) -> StoreResult<()> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        let existing = chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("channel {channel_id}")))?;
        let mut am: chat_channel::ActiveModel = existing.into();
        am.last_message_preview = Set(Some(preview));
        am.last_message_at = Set(Some(at));
        am.update(self.db.as_ref()).await?;
        Ok(())
    }

    async fn list_messages(
        &self,
        channel_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_message::Model>> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        Ok(chat_message::Entity::find()
            .filter(chat_message::Column::ChannelId.eq(uuid))
            .order_by_asc(chat_message::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_message(&self, msg: NewChatMessage) -> StoreResult<chat_message::Model> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let model = chat_message::ActiveModel {
            id: Set(id),
            channel_id: Set(msg.channel_id),
            sender_type: Set(msg.sender_type.clone()),
            sender_id: Set(msg.sender_id),
            content: Set(msg.content.clone()),
            kind: Set(msg.kind.clone()),
            attachments: Set(msg.attachments.clone()),
            status: Set("sent".into()),
            client_msg_id: Set(msg.client_msg_id.clone()),
            created_at: Set(now.clone()),
        };
        chat_message::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(chat_message::Model {
            id,
            channel_id: msg.channel_id,
            sender_type: msg.sender_type,
            sender_id: msg.sender_id,
            content: msg.content,
            kind: msg.kind,
            attachments: msg.attachments,
            status: "sent".into(),
            client_msg_id: msg.client_msg_id,
            created_at: now,
        })
    }

    async fn message_exists_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> StoreResult<bool> {
        Ok(self
            .find_message_by_client_id(channel_id, client_msg_id)
            .await?
            .is_some())
    }

    async fn find_message_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> StoreResult<Option<chat_message::Model>> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        Ok(chat_message::Entity::find()
            .filter(chat_message::Column::ChannelId.eq(uuid))
            .filter(chat_message::Column::ClientMsgId.eq(client_msg_id.to_string()))
            .one(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_zeroclaw_exchange(&self, ex: NewZeroClawExchange) -> StoreResult<()> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let model = zero_claw_exchange::ActiveModel {
            id: Set(id),
            channel_id: Set(ex.channel_id),
            user_message_id: Set(ex.user_message_id),
            assistant_message_id: Set(ex.assistant_message_id),
            prompt: Set(ex.prompt),
            completion: Set(ex.completion),
            model: Set(ex.model),
            latency_ms: Set(ex.latency_ms),
            handoff_to_human: Set(ex.handoff_to_human),
            created_at: Set(now),
        };
        zero_claw_exchange::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn list_zeroclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<zero_claw_exchange::Model>> {
        Ok(zero_claw_exchange::Entity::find()
            .order_by_desc(zero_claw_exchange::Column::CreatedAt)
            .offset(offset)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn clear_unread(&self, channel_id: &str, side: &str) -> StoreResult<()> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        let existing = chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("channel {channel_id}")))?;
        let mut am: chat_channel::ActiveModel = existing.into();
        if side == "user" {
            am.unread_user = Set(0);
        } else {
            am.unread_employee = Set(0);
        }
        am.update(self.db.as_ref()).await?;
        Ok(())
    }

    async fn increment_unread(&self, channel_id: &str, side: &str) -> StoreResult<()> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        let existing = chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?
            .ok_or_else(|| StoreError::NotFound(format!("channel {channel_id}")))?;
        // Capture the current counters BEFORE `existing.into()` moves
        // the model into `ActiveModel` (the original `existing` would
        // be borrowed-after-move otherwise).
        let next_unread_user = existing.unread_user + 1;
        let next_unread_employee = existing.unread_employee + 1;
        let mut am: chat_channel::ActiveModel = existing.into();
        if side == "user" {
            am.unread_user = Set(next_unread_user);
        } else {
            am.unread_employee = Set(next_unread_employee);
        }
        am.update(self.db.as_ref()).await?;
        Ok(())
    }

    async fn invalidate(&self, _channel_id: Option<&str>) {}

    // ── Channel members ─────────────────────────────────────────────

    /// Insert a member row. Uses `INSERT ... ON CONFLICT DO NOTHING`
    /// semantics so it's idempotent — re-adding an existing member is
    /// a no-op rather than an error. We emulate this in a backend-neutral
    /// way by catching the unique-constraint error and returning Ok.
    async fn add_channel_member(&self, member: NewChannelMember) -> StoreResult<()> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let model = chat_channel_member::ActiveModel {
            id: Set(id),
            channel_id: Set(member.channel_id),
            user_id: Set(member.user_id),
            role: Set(member.role),
            joined_at: Set(now),
            left_at: Set(None),
        };
        match chat_channel_member::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await
        {
            Ok(_) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                // UNIQUE violation → already a member. Both SQLite
                // ("unique") and Postgres ("duplicate key") surface this
                // via the same string match.
                if msg.contains("unique") || msg.contains("duplicate") || msg.contains("conflict")
                {
                    Ok(())
                } else {
                    Err(e.into())
                }
            }
        }
    }

    async fn list_channel_members(
        &self,
        channel_id: &str,
    ) -> StoreResult<Vec<chat_channel_member::Model>> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        Ok(chat_channel_member::Entity::find()
            .filter(chat_channel_member::Column::ChannelId.eq(uuid))
            .filter(chat_channel_member::Column::LeftAt.is_null())
            .all(self.db.as_ref())
            .await?)
    }
}

// ────────────────────────────────────────────────────────────────
//  Cache wrapper
// ────────────────────────────────────────────────────────────────

pub struct CacheChatStore<S: ChatStore> {
    pub inner: Arc<S>,
    pub cache: Arc<dyn CacheBackend>,
    pub ttl: Duration,
}

impl<S: ChatStore> CacheChatStore<S> {
    pub fn new(inner: S, cache: Arc<dyn CacheBackend>, ttl: Duration) -> Self {
        Self {
            inner: Arc::new(inner),
            cache,
            ttl,
        }
    }
}

impl<S: ChatStore> Clone for CacheChatStore<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            cache: self.cache.clone(),
            ttl: self.ttl,
        }
    }
}

fn key_channel_exists(channel_id: &str) -> String {
    format!("chat:channel:exists:{channel_id}")
}

fn key_channel(channel_id: &str) -> String {
    format!("chat:channel:{channel_id}")
}

#[async_trait]
impl<S: ChatStore> ChatStore for CacheChatStore<S> {
    async fn channel_exists(&self, channel_id: &str) -> StoreResult<bool> {
        let key = key_channel_exists(channel_id);
        match get_serializable::<bool>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => {}
            Err(e) => {
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB")
            }
        }
        let exists = self.inner.channel_exists(channel_id).await?;
        let _ = set_serializable(self.cache.as_ref(), &key, &exists, Some(self.ttl)).await;
        Ok(exists)
    }

    async fn get_channel(&self, channel_id: &str) -> StoreResult<Option<chat_channel::Model>> {
        let key = key_channel(channel_id);
        match get_serializable::<Option<chat_channel::Model>>(self.cache.as_ref(), &key).await {
            Ok(Some(v)) => return Ok(v),
            Ok(None) => {}
            Err(e) => {
                tracing::debug!(key = %key, error = %e, "cache read failed; falling through to DB")
            }
        }
        let model = self.inner.get_channel(channel_id).await?;
        let _ = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await;
        Ok(model)
    }

    async fn list_channels(
        &self,
        user_id: Uuid,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        self.inner.list_channels(user_id, limit).await
    }

    async fn list_open_channels(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        self.inner.list_open_channels(brand_id, limit).await
    }

    async fn create_channel(
        &self,
        user_id: Uuid,
        brand_id: Option<Uuid>,
        topic: Option<String>,
    ) -> StoreResult<chat_channel::Model> {
        self.inner.create_channel(user_id, brand_id, topic).await
    }

    async fn update_channel_preview(
        &self,
        channel_id: &str,
        preview: String,
        at: String,
    ) -> StoreResult<()> {
        let res = self
            .inner
            .update_channel_preview(channel_id, preview, at)
            .await;
        if res.is_ok() {
            let _ = self.cache.delete(&key_channel(channel_id)).await;
            let _ = self.cache.delete(&key_channel_exists(channel_id)).await;
        }
        res
    }

    async fn list_messages(
        &self,
        channel_id: &str,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_message::Model>> {
        self.inner.list_messages(channel_id, limit, offset).await
    }

    async fn insert_message(&self, msg: NewChatMessage) -> StoreResult<chat_message::Model> {
        self.inner.insert_message(msg).await
    }

    async fn message_exists_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> StoreResult<bool> {
        self.inner
            .message_exists_by_client_id(channel_id, client_msg_id)
            .await
    }

    async fn find_message_by_client_id(
        &self,
        channel_id: &str,
        client_msg_id: &str,
    ) -> StoreResult<Option<chat_message::Model>> {
        self.inner
            .find_message_by_client_id(channel_id, client_msg_id)
            .await
    }

    async fn insert_zeroclaw_exchange(&self, ex: NewZeroClawExchange) -> StoreResult<()> {
        self.inner.insert_zeroclaw_exchange(ex).await
    }

    async fn list_zeroclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<zero_claw_exchange::Model>> {
        self.inner.list_zeroclaw_exchanges(limit, offset).await
    }

    async fn clear_unread(&self, channel_id: &str, side: &str) -> StoreResult<()> {
        let res = self.inner.clear_unread(channel_id, side).await;
        if res.is_ok() {
            let _ = self.cache.delete(&key_channel(channel_id)).await;
        }
        res
    }

    async fn increment_unread(&self, channel_id: &str, side: &str) -> StoreResult<()> {
        let res = self.inner.increment_unread(channel_id, side).await;
        if res.is_ok() {
            // Invalidate the cached channel row so the next read sees
            // the new unread count.
            let _ = self.cache.delete(&key_channel(channel_id)).await;
        }
        res
    }

    async fn invalidate(&self, channel_id: Option<&str>) {
        if let Some(id) = channel_id {
            let _ = self.cache.delete(&key_channel(id)).await;
            let _ = self.cache.delete(&key_channel_exists(id)).await;
        }
    }

    async fn add_channel_member(&self, member: NewChannelMember) -> StoreResult<()> {
        self.inner.add_channel_member(member).await
    }

    async fn list_channel_members(
        &self,
        channel_id: &str,
    ) -> StoreResult<Vec<chat_channel_member::Model>> {
        self.inner.list_channel_members(channel_id).await
    }
}
