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
use crate::entity::{chat_channel, chat_message, zero_claw_exchange};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  New-row DTOs
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct NewChatMessage {
    pub channel_id: String,
    pub sender_type: String,
    pub sender_id: Option<String>,
    pub content: Option<String>,
    pub kind: String,
    pub attachments: Option<String>,
    pub client_msg_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewZeroClawExchange {
    pub channel_id: Option<String>,
    pub user_message_id: Option<String>,
    pub assistant_message_id: Option<String>,
    pub prompt: Option<String>,
    pub completion: Option<String>,
    pub model: Option<String>,
    pub latency_ms: Option<i64>,
    pub handoff_to_human: bool,
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait ChatStore: Send + Sync {
    async fn channel_exists(&self, channel_id: &str) -> StoreResult<bool>;
    async fn get_channel(&self, channel_id: &str) -> StoreResult<Option<chat_channel::Model>>;
    async fn list_channels(
        &self,
        user_id: &str,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>>;
    async fn create_channel(
        &self,
        user_id: String,
        brand_id: Option<String>,
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
    async fn insert_zeroclaw_exchange(&self, ex: NewZeroClawExchange) -> StoreResult<()>;
    async fn list_zeroclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<zero_claw_exchange::Model>>;
    /// Clear the unread counter for one side of a channel (`"user"` or
    /// `"employee"`). Best-effort — returns `Ok(())` if the channel is gone.
    async fn clear_unread(&self, channel_id: &str, side: &str) -> StoreResult<()>;
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
        user_id: &str,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        Ok(chat_channel::Entity::find()
            .filter(chat_channel::Column::UserId.eq(user_id))
            .order_by_desc(chat_channel::Column::LastMessageAt)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn create_channel(
        &self,
        user_id: String,
        brand_id: Option<String>,
        topic: Option<String>,
    ) -> StoreResult<chat_channel::Model> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let user_id_clone = user_id.clone();
        let brand_id_clone = brand_id.clone();
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
            user_id: user_id_clone,
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
        Ok(chat_message::Entity::find()
            .filter(chat_message::Column::ChannelId.eq(channel_id))
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
            channel_id: Set(msg.channel_id.clone()),
            sender_type: Set(msg.sender_type.clone()),
            sender_id: Set(msg.sender_id.clone()),
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
        Ok(chat_message::Entity::find()
            .filter(chat_message::Column::ChannelId.eq(channel_id))
            .filter(chat_message::Column::ClientMsgId.eq(client_msg_id))
            .one(self.db.as_ref())
            .await?
            .is_some())
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

    async fn invalidate(&self, _channel_id: Option<&str>) {}
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
                tracing::warn!(key = %key, error = %e, "cache read failed; falling through to DB")
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
                tracing::warn!(key = %key, error = %e, "cache read failed; falling through to DB")
            }
        }
        let model = self.inner.get_channel(channel_id).await?;
        let _ = set_serializable(self.cache.as_ref(), &key, &model, Some(self.ttl)).await;
        Ok(model)
    }

    async fn list_channels(
        &self,
        user_id: &str,
        limit: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        self.inner.list_channels(user_id, limit).await
    }

    async fn create_channel(
        &self,
        user_id: String,
        brand_id: Option<String>,
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

    async fn invalidate(&self, channel_id: Option<&str>) {
        if let Some(id) = channel_id {
            let _ = self.cache.delete(&key_channel(id)).await;
            let _ = self.cache.delete(&key_channel_exists(id)).await;
        }
    }
}
