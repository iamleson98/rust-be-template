//! Chat store — read/write access to chat channels, messages, and
//! NullClaw audit exchanges. Used by the WebSocket chat hub and the
//! NullClaw AI assistant.
//!
//! Follows the template's store pattern: `ChatStore` trait +
//! `DbChatStore` (`#[retry]`) + `CacheChatStore<S>` wrapper.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use store_macros::retry;
use uuid::Uuid;

use crate::cache::{get_serializable, set_serializable, CacheBackend};
use crate::entity::{
    chat_assignment, chat_channel, chat_channel_member, chat_message, null_claw_exchange,
};

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
pub struct NewNullClawExchange {
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
    ///
    /// `offset` is 0-based page pagination on the same ordering
    /// (`last_message_at DESC`) — supports the admin workspace's
    /// infinite channel list (scroll down → fetch the next page of
    /// older-activity channels).
    async fn list_channels(
        &self,
        user_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_channel::Model>>;
    /// List all OPEN channels — the employee support queue.
    /// Optionally filtered by brand. Used by the admin chat dashboard
    /// so all support staff see the same queue.
    ///
    /// `offset` is 0-based page pagination on `last_message_at DESC`
    /// (most recent activity first) — the queue's initial page shows
    /// the most recent channels, scrolling down appends older ones.
    async fn list_open_channels(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_channel::Model>>;
    /// Count channels grouped by status — used by the admin chat
    /// dashboard's top-row cards (open / assigned / closed counts).
    /// Returns a map of `status → count`.
    ///
    /// This is a server-side aggregate (not client-side filtering of
    /// `list_open_channels`) so it returns the TRUE count even when
    /// there are more channels than the list's `limit` (which caps
    /// at 200). Without this, the "Đang chờ" card would max out at
    /// the list's page size.
    async fn count_channels_by_status(&self) -> StoreResult<Vec<(String, i64)>>;
    /// Compute the average first-response time across all channels
    /// that have at least one user message + one employee reply.
    ///
    /// "First response" = time between the first `sender_type='user'`
    /// message + the first `sender_type='employee'` message in the
    /// SAME channel. Channels without an employee reply are excluded
    /// (no response = no data point).
    ///
    /// Returns the average in seconds (0.0 if no channels have a
    /// response yet).
    async fn avg_first_response_time_secs(&self) -> StoreResult<f64>;
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
    async fn insert_nullclaw_exchange(&self, ex: NewNullClawExchange) -> StoreResult<()>;
    async fn list_nullclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<null_claw_exchange::Model>>;
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
    //   - the NullClaw bot (role="bot")
    //
    // Employees don't get explicit member rows — they see all open
    // channels in their brand via `list_open_channels`. This avoids
    // N×M membership explosion (every channel × every employee).

    /// Add a member to a channel. Idempotent — uses INSERT OR IGNORE
    /// semantics via the unique(channel_id, user_id) index. Returns
    /// `Ok(())` even if the member already exists.
    async fn add_channel_member(&self, member: NewChannelMember) -> StoreResult<()>;
    /// The channel's CURRENT assignment row (unassigned_at IS NULL), if any.
    async fn get_active_assignment(
        &self,
        channel_id: &str,
    ) -> StoreResult<Option<chat_assignment::Model>>;
    /// Assign (or re-assign) a channel to an employee. Also flips the
    /// channel status to "assigned".
    async fn upsert_assignment(
        &self,
        channel_id: &str,
        employee_id: &str,
    ) -> StoreResult<chat_assignment::Model>;
    /// End the active assignment (channel goes back to "open").
    async fn release_assignment(&self, channel_id: &str) -> StoreResult<()>;
    /// Close a channel + end any active assignment.
    async fn close_channel(&self, channel_id: &str) -> StoreResult<()>;
    /// Batch-fetch the active assignment rows for a list of channels
    /// (channel list DTO enrichment — avoids N+1).
    async fn list_active_assignments(
        &self,
        channel_ids: &[Uuid],
    ) -> StoreResult<Vec<chat_assignment::Model>>;
    /// How many channels are actively assigned to this employee.
    async fn count_active_assignments(&self, employee_id: &str) -> StoreResult<i64>;
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
        offset: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        Ok(chat_channel::Entity::find()
            .filter(chat_channel::Column::UserId.eq(user_id))
            .order_by_desc(chat_channel::Column::LastMessageAt)
            .offset(offset)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_open_channels(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        // The staff support queue = every channel that is NOT closed:
        // "open" (waiting / bot-owned) + "assigned" (an employee owns
        // it). Previously this fetched only `status = "open"`, which
        // made channels DISAPPEAR from the queue the moment
        // `upsert_assignment` flipped them to "assigned" — including
        // the creation-time assignment, where the channel would drop
        // out of the queue before any staff ever saw it.
        //
        // `offset` pages through the queue on the same ordering —
        // the admin workspace's channel list loads the most recent
        // `limit` channels first + fetches more as the staff scrolls.
        let mut q = chat_channel::Entity::find()
            .filter(chat_channel::Column::Status.is_in(["open", "assigned"]))
            .order_by_desc(chat_channel::Column::LastMessageAt)
            .offset(offset)
            .limit(limit);
        if let Some(brand_id) = brand_id {
            q = q.filter(chat_channel::Column::BrandId.eq(brand_id));
        }
        Ok(q.all(self.db.as_ref()).await?)
    }

    async fn count_channels_by_status(&self) -> StoreResult<Vec<(String, i64)>> {
        // Group channels by status + count each group. SeaORM doesn't
        // have a clean `GROUP BY` builder, so we use raw SQL via
        // `execute_unprepared` (portable raw SQL for the engine's dialect).
        //
        // Returns `Vec<(status, count)>` — e.g. `[("open", 42), ("assigned", 3), ("closed", 15)]`.
        use sea_orm::FromQueryResult;

        #[derive(FromQueryResult)]
        struct StatusCount {
            status: String,
            count: i64,
        }

        let rows = StatusCount::find_by_statement(sea_orm::Statement::from_sql_and_values(
            self.db.as_ref().get_database_backend(),
            r#"SELECT status, COUNT(*) as count FROM chat_channel GROUP BY status"#,
            [],
        ))
        .all(self.db.as_ref())
        .await?;

        Ok(rows.into_iter().map(|r| (r.status, r.count)).collect())
    }

    async fn avg_first_response_time_secs(&self) -> StoreResult<f64> {
        // ── Compute average first-response time across all channels ──
        //
        // For each channel, find:
        //   - t_user: the first `sender_type='user'` message's `created_at`
        //   - t_employee: the first `sender_type='employee'` message's `created_at`
        //
        // If both exist + t_employee > t_user, the response time is
        // `t_employee - t_user`. Average across all such channels.
        //
        // We use raw SQL because SeaORM doesn't have a clean way to
        // express "find the min created_at per (channel_id, sender_type)
        // group, then join the two groups on channel_id + compute the
        // avg of the difference". The query below works on both SQLite
        // (standard SQL window functions, supported by the engine).
        //
        // Returns 0.0 if no channels have both a user + employee message.
        use sea_orm::FromQueryResult;

        #[derive(FromQueryResult)]
        struct AvgResult {
            avg_secs: Option<f64>,
        }

        // The inner subquery finds the first user + first employee
        // message per channel. The outer query averages the difference.
        //
        // NOTE: `created_at` is stored as TEXT (ISO 8601 RFC 3339).
        // The rust-sql engine's `julianday()` converts to a float
        // (days) — multiply by 86400.0 for seconds.
        let backend = self.db.as_ref().get_database_backend();
        let sql = r#"SELECT
                    AVG(
                        (julianday(e.first_emp) - julianday(u.first_user)) * 86400.0
                    ) as avg_secs
                FROM (
                    SELECT channel_id, MIN(created_at) as first_user
                    FROM chat_message
                    WHERE sender_type = 'user'
                    GROUP BY channel_id
                ) u
                JOIN (
                    SELECT channel_id, MIN(created_at) as first_emp
                    FROM chat_message
                    WHERE sender_type = 'employee'
                    GROUP BY channel_id
                ) e ON u.channel_id = e.channel_id
                WHERE e.first_emp > u.first_user"#;

        let row =
            AvgResult::find_by_statement(sea_orm::Statement::from_sql_and_values(backend, sql, []))
                .one(self.db.as_ref())
                .await?;

        Ok(row.and_then(|r| r.avg_secs).unwrap_or(0.0))
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
        // ── Newest-first ordering for cursor pagination ─────────────
        //
        // Modern chat systems (Messenger, Discord, WhatsApp) load the
        // LATEST N messages first, then load older ones as the user
        // scrolls up. To support this with offset/limit pagination:
        //
        //   - `offset=0, limit=30` → the 30 newest messages
        //   - `offset=30, limit=30` → the next 30 older messages
        //   - etc.
        //
        // The caller (frontend) reverses the page before rendering so
        // the oldest of the page is at the top + the newest at the
        // bottom — the natural chat reading order.
        //
        // Previously this was `order_by_asc(CreatedAt)` which returned
        // the OLDEST messages first. With offset+limit that meant: if
        // the channel had 60 messages + limit=50, you got the 50 oldest
        // — the latest 10 were invisible until you manually paginated.
        // That's the "new messages stop showing up" bug.
        Ok(chat_message::Entity::find()
            .filter(chat_message::Column::ChannelId.eq(uuid))
            .order_by_desc(chat_message::Column::CreatedAt)
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
    async fn insert_nullclaw_exchange(&self, ex: NewNullClawExchange) -> StoreResult<()> {
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        let model = null_claw_exchange::ActiveModel {
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
        null_claw_exchange::Entity::insert(model)
            .exec_without_returning(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn list_nullclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<null_claw_exchange::Model>> {
        Ok(null_claw_exchange::Entity::find()
            .order_by_desc(null_claw_exchange::Column::CreatedAt)
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
                // ("unique") and other engines ("duplicate key") surface this
                // via the same string match.
                if msg.contains("unique") || msg.contains("duplicate") || msg.contains("conflict") {
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

    // ── chat assignments ─────────────────────────────────────────

    async fn get_active_assignment(
        &self,
        channel_id: &str,
    ) -> StoreResult<Option<chat_assignment::Model>> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        Ok(chat_assignment::Entity::find()
            .filter(chat_assignment::Column::ChannelId.eq(uuid))
            .filter(chat_assignment::Column::UnassignedAt.is_null())
            .order_by_desc(chat_assignment::Column::AssignedAt)
            .one(self.db.as_ref())
            .await?)
    }

    async fn upsert_assignment(
        &self,
        channel_id: &str,
        employee_id: &str,
    ) -> StoreResult<chat_assignment::Model> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        let now = chrono::Utc::now().to_rfc3339();

        // One assignment row per channel (`channel_id` is UNIQUE) —
        // re-assignment reuses the row so history stays single-line.
        let model = match chat_assignment::Entity::find()
            .filter(chat_assignment::Column::ChannelId.eq(uuid))
            .one(self.db.as_ref())
            .await?
        {
            Some(existing) => {
                let mut am: chat_assignment::ActiveModel = existing.into();
                am.employee_id = Set(Some(employee_id.to_string()));
                am.assigned_at = Set(now.clone());
                am.unassigned_at = Set(None);
                am.update(self.db.as_ref()).await?
            }
            None => {
                let id = Uuid::new_v4();
                let am = chat_assignment::ActiveModel {
                    id: Set(id),
                    channel_id: Set(uuid),
                    employee_id: Set(Some(employee_id.to_string())),
                    assigned_at: Set(now.clone()),
                    unassigned_at: Set(None),
                };
                chat_assignment::Entity::insert(am)
                    .exec_without_returning(self.db.as_ref())
                    .await?;
                chat_assignment::Model {
                    id,
                    channel_id: uuid,
                    employee_id: Some(employee_id.to_string()),
                    assigned_at: now.clone(),
                    unassigned_at: None,
                }
            }
        };

        // Channel flips to "assigned" while an employee owns it.
        Self::set_channel_status_tx(self, uuid, "assigned").await?;
        Ok(model)
    }

    async fn release_assignment(&self, channel_id: &str) -> StoreResult<()> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(existing) = chat_assignment::Entity::find()
            .filter(chat_assignment::Column::ChannelId.eq(uuid))
            .filter(chat_assignment::Column::UnassignedAt.is_null())
            .one(self.db.as_ref())
            .await?
        {
            let mut am: chat_assignment::ActiveModel = existing.into();
            am.unassigned_at = Set(Some(now));
            am.update(self.db.as_ref()).await?;
        }
        Self::set_channel_status_tx(self, uuid, "open").await?;
        Ok(())
    }

    async fn close_channel(&self, channel_id: &str) -> StoreResult<()> {
        let uuid = Uuid::parse_str(channel_id)
            .map_err(|_| StoreError::Validation(format!("invalid channel id: {channel_id}")))?;
        let now = chrono::Utc::now().to_rfc3339();
        // End any active assignment first (keeps the audit trail).
        if let Some(existing) = chat_assignment::Entity::find()
            .filter(chat_assignment::Column::ChannelId.eq(uuid))
            .filter(chat_assignment::Column::UnassignedAt.is_null())
            .one(self.db.as_ref())
            .await?
        {
            let mut am: chat_assignment::ActiveModel = existing.into();
            am.unassigned_at = Set(Some(now.clone()));
            am.update(self.db.as_ref()).await?;
        }
        if let Some(channel) = chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?
        {
            let mut am: chat_channel::ActiveModel = channel.into();
            am.status = Set("closed".into());
            am.closed_at = Set(Some(now));
            am.update(self.db.as_ref()).await?;
        }
        Ok(())
    }

    async fn list_active_assignments(
        &self,
        channel_ids: &[Uuid],
    ) -> StoreResult<Vec<chat_assignment::Model>> {
        if channel_ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(chat_assignment::Entity::find()
            .filter(chat_assignment::Column::ChannelId.is_in(channel_ids.to_vec()))
            .filter(chat_assignment::Column::UnassignedAt.is_null())
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_active_assignments(&self, employee_id: &str) -> StoreResult<i64> {
        // Active rows ARE the truth: release + close both stamp
        // `unassigned_at`, so no join on channel status is needed.
        use sea_orm::PaginatorTrait;
        Ok(chat_assignment::Entity::find()
            .filter(chat_assignment::Column::EmployeeId.eq(employee_id.to_string()))
            .filter(chat_assignment::Column::UnassignedAt.is_null())
            .count(self.db.as_ref())
            .await? as i64)
    }
}

impl DbChatStore {
    /// Internal helper: update a channel's status column.
    async fn set_channel_status_tx(&self, uuid: Uuid, status: &str) -> StoreResult<()> {
        if let Some(channel) = chat_channel::Entity::find_by_id(uuid)
            .one(self.db.as_ref())
            .await?
        {
            let mut am: chat_channel::ActiveModel = channel.into();
            am.status = Set(status.to_string());
            am.update(self.db.as_ref()).await?;
        }
        Ok(())
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
        offset: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        self.inner.list_channels(user_id, limit, offset).await
    }

    async fn list_open_channels(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<chat_channel::Model>> {
        self.inner
            .list_open_channels(brand_id, limit, offset)
            .await
    }

    async fn count_channels_by_status(&self) -> StoreResult<Vec<(String, i64)>> {
        // Aggregate queries are not cached — they need fresh results
        // every call (the channel count changes on every new channel).
        self.inner.count_channels_by_status().await
    }

    async fn avg_first_response_time_secs(&self) -> StoreResult<f64> {
        // Same as count_channels_by_status — aggregate, not cached.
        self.inner.avg_first_response_time_secs().await
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

    async fn insert_nullclaw_exchange(&self, ex: NewNullClawExchange) -> StoreResult<()> {
        self.inner.insert_nullclaw_exchange(ex).await
    }

    async fn list_nullclaw_exchanges(
        &self,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<null_claw_exchange::Model>> {
        self.inner.list_nullclaw_exchanges(limit, offset).await
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

    async fn get_active_assignment(
        &self,
        channel_id: &str,
    ) -> StoreResult<Option<chat_assignment::Model>> {
        self.inner.get_active_assignment(channel_id).await
    }

    async fn upsert_assignment(
        &self,
        channel_id: &str,
        employee_id: &str,
    ) -> StoreResult<chat_assignment::Model> {
        // Assignments are write-path state — never cached (and any
        // cached channel rows are dropped so status flips propagate).
        self.invalidate(Some(channel_id)).await;
        self.inner.upsert_assignment(channel_id, employee_id).await
    }

    async fn release_assignment(&self, channel_id: &str) -> StoreResult<()> {
        self.invalidate(Some(channel_id)).await;
        self.inner.release_assignment(channel_id).await
    }

    async fn close_channel(&self, channel_id: &str) -> StoreResult<()> {
        self.invalidate(Some(channel_id)).await;
        self.inner.close_channel(channel_id).await
    }

    async fn list_active_assignments(
        &self,
        channel_ids: &[Uuid],
    ) -> StoreResult<Vec<chat_assignment::Model>> {
        // Fresh state required — pass straight through.
        self.inner.list_active_assignments(channel_ids).await
    }

    async fn count_active_assignments(&self, employee_id: &str) -> StoreResult<i64> {
        self.inner.count_active_assignments(employee_id).await
    }

    async fn list_channel_members(
        &self,
        channel_id: &str,
    ) -> StoreResult<Vec<chat_channel_member::Model>> {
        self.inner.list_channel_members(channel_id).await
    }
}

#[cfg(test)]
mod tests {
    //! Offset-pagination coverage for the admin workspace's infinite
    //! channel list: page 1 = the most recently active channels,
    //! `offset` advances toward older ones, closed channels never
    //! appear in the staff queue.
    use super::*;
    use sea_orm::{Database, EntityTrait, Set};

    /// In-memory chat store with just the `chat_channel` table
    /// (mirrors the migration DDL; the user FK is omitted — no users
    /// table needed for pagination semantics).
    async fn mem_store() -> DbChatStore {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            r#"CREATE TABLE chat_channel (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                brand_id TEXT,
                topic TEXT(255),
                status TEXT(30) NOT NULL DEFAULT 'open',
                priority TEXT(10) NOT NULL DEFAULT 'normal',
                last_message_at TEXT,
                last_message_preview TEXT(500),
                unread_user INTEGER NOT NULL DEFAULT 0,
                unread_employee INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                closed_at TEXT
            )"#,
        )
        .await
        .unwrap();
        DbChatStore::new(std::sync::Arc::new(db))
    }

    fn channel(user_id: Uuid, status: &str, last_message_at: &str) -> chat_channel::ActiveModel {
        chat_channel::ActiveModel {
            id: Set(Uuid::new_v4()),
            user_id: Set(user_id),
            brand_id: Set(None),
            topic: Set(None),
            status: Set(status.into()),
            priority: Set("normal".into()),
            last_message_at: Set(Some(last_message_at.into())),
            last_message_preview: Set(None),
            unread_user: Set(0),
            unread_employee: Set(0),
            created_at: Set("2026-09-08T00:00:00Z".into()),
            closed_at: Set(None),
        }
    }

    #[tokio::test]
    async fn open_queue_pages_by_offset_most_recent_first() {
        let store = mem_store().await;
        // 5 channels with strictly ordered activity; #5 most recent.
        let user = Uuid::new_v4();
        for i in 1..=5 {
            let at = format!("2026-09-0{i}T12:00:00Z");
            let mut am = channel(user, "open", &at);
            // Distinct users keep list_channels' per-customer filter
            // from short-circuiting the queue query.
            am.user_id = Set(Uuid::new_v4());
            chat_channel::Entity::insert(am)
                .exec(store.db.as_ref())
                .await
                .unwrap();
        }

        // Page 1: the two most recently active channels.
        let page1 = store.list_open_channels(None, 2, 0).await.unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].last_message_at.as_deref(), Some("2026-09-05T12:00:00Z"));
        assert_eq!(page1[1].last_message_at.as_deref(), Some("2026-09-04T12:00:00Z"));

        // Page 2 (offset=2): the next two, strictly older.
        let page2 = store.list_open_channels(None, 2, 2).await.unwrap();
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].last_message_at.as_deref(), Some("2026-09-03T12:00:00Z"));
        assert_eq!(page2[1].last_message_at.as_deref(), Some("2026-09-02T12:00:00Z"));

        // Page 3 (offset=4): the last one — a partial page means
        // "no more" for the frontend's hasNextPage heuristic.
        let page3 = store.list_open_channels(None, 2, 4).await.unwrap();
        assert_eq!(page3.len(), 1);
        assert_eq!(page3[0].last_message_at.as_deref(), Some("2026-09-01T12:00:00Z"));

        // Beyond the end: empty page.
        let page4 = store.list_open_channels(None, 2, 6).await.unwrap();
        assert!(page4.is_empty());
    }

    #[tokio::test]
    async fn closed_channels_are_never_in_the_queue() {
        let store = mem_store().await;
        let mut closed = channel(Uuid::new_v4(), "closed", "2026-09-08T10:00:00Z");
        closed.closed_at = Set(Some("2026-09-08T10:05:00Z".into()));
        chat_channel::Entity::insert(closed)
            .exec(store.db.as_ref())
            .await
            .unwrap();
        chat_channel::Entity::insert(channel(
            Uuid::new_v4(),
            "open",
            "2026-09-07T10:00:00Z",
        ))
        .exec(store.db.as_ref())
        .await
        .unwrap();

        // Even with offset 0 and a big limit, the closed channel is
        // excluded — pagination must never resurrect it on a later page.
        for offset in [0u64, 1] {
            let page = store.list_open_channels(None, 50, offset).await.unwrap();
            assert!(
                page.iter().all(|c| c.status != "closed"),
                "closed channel leaked into queue page {offset}"
            );
        }
    }

    #[tokio::test]
    async fn customer_channel_list_pages_by_offset() {
        let store = mem_store().await;
        let user = Uuid::new_v4();
        // The customer's own 4 channels (distinct activity) + one
        // channel belonging to somebody else.
        for i in 1..=4 {
            let at = format!("2026-08-0{i}T09:00:00Z");
            chat_channel::Entity::insert(channel(user, "open", &at))
                .exec(store.db.as_ref())
                .await
                .unwrap();
        }
        chat_channel::Entity::insert(channel(Uuid::new_v4(), "open", "2026-09-08T09:00:00Z"))
            .exec(store.db.as_ref())
            .await
            .unwrap();

        // Page 1: the customer's 3 most recent channels only.
        let page1 = store.list_channels(user, 3, 0).await.unwrap();
        assert_eq!(page1.len(), 3);
        assert!(page1.iter().all(|c| c.user_id == user));
        assert_eq!(page1[0].last_message_at.as_deref(), Some("2026-08-04T09:00:00Z"));

        // Page 2: the customer's oldest channel — not the stranger's.
        let page2 = store.list_channels(user, 3, 3).await.unwrap();
        assert_eq!(page2.len(), 1);
        assert_eq!(page2[0].user_id, user);
        assert_eq!(page2[0].last_message_at.as_deref(), Some("2026-08-01T09:00:00Z"));

        // No third page for this customer.
        let page3 = store.list_channels(user, 3, 6).await.unwrap();
        assert!(page3.is_empty());
    }
}
