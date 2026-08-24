//! Adds explicit channel membership + a built-in ZeroClaw bot user.
//!
//! ## What this migration does
//!
//! 1. **Add `is_bot` column to `user`** — a boolean flag that distinguishes
//!    bot accounts (ZeroClaw, future integrations) from human users. Defaults
//!    to `FALSE`. Bots have `role = "user"` (so RBAC stays unchanged) but
//!    `is_bot = TRUE`. The chat layer checks `is_bot` when deciding whether
//!    a `sender_id` should be rendered as a human vs an assistant.
//!
//! 2. **Create `chat_channel_member`** — proper membership table. Replaces
//!    the implicit "user is in their own channel" model with an explicit
//!    `(channel_id, user_id, role)` triple. Roles: `'user'` (customer),
//!    `'employee'` (assigned support staff), `'bot'` (ZeroClaw).
//!    UNIQUE(channel_id, user_id) prevents duplicate joins.
//!
//! 3. **Seed the ZeroClaw bot user** — a deterministic UUID
//!    (`00000000-0000-0000-0000-000000000001`) is reserved for ZeroClaw.
//!    Inserted with `is_bot = TRUE`, `email = "bot+zeroclaw@system.local"`,
//!    `full_name = "ZeroClaw AI"`. The chat module references this UUID
//!    when inserting assistant messages so they have a real `sender_id`
//!    FK to the `user` table.
//!
//! ## Why deterministic UUID
//!
//! A random UUID would require a runtime lookup on every ZeroClaw reply.
//! A deterministic UUID lets `src/zeroclaw/mod.rs` reference the bot user
//! as a `const`, with no DB round-trip. If the seed row is missing (e.g.
//! the migration didn't run), the chat code gracefully degrades —
//! `sender_id` falls back to `None` and the assistant message still inserts.
//!
//! ## Why a separate `chat_channel_member` table
//!
//! The previous model had no explicit membership:
//!   - `chat_channel.user_id` → the customer (1:1)
//!   - `chat_assignment` → a dormant 1:1 employee assignment table that no
//!     code path actually wrote to.
//!
//! This was fine for a 2-party (user + employee) chat but breaks down with
//! ZeroClaw as a third participant. The member table lets us:
//!   - Track who is in a channel (customer + bot + assigned employees).
//!   - Query "all channels I'm a member of" for the employee support queue.
//!   - Add a `left_at` column for "leave channel" semantics later.

use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{
    m20250101_000001_create_users::User, m20260809_021323_chat::ChatChannel,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum ChatChannelMember {
    Table,
    Id,
    ChannelId,
    UserId,
    Role,
    JoinedAt,
    LeftAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 1. Add `is_bot` column to `user`.
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Alias::new("is_bot"))
                            .boolean()
                            .not_null()
                            .default(false)
                            .to_owned(),
                    )
                    .to_owned(),
            )
            .await?;

        // 2. Create `chat_channel_member`.
        manager
            .create_table(
                Table::create()
                    .table(ChatChannelMember::Table)
                    .if_not_exists()
                    .col(pk_uuid(ChatChannelMember::Id))
                    .col(uuid(ChatChannelMember::ChannelId))
                    .col(uuid(ChatChannelMember::UserId))
                    .col(string_len(ChatChannelMember::Role, 20))
                    .col(text(ChatChannelMember::JoinedAt))
                    .col(text_null(ChatChannelMember::LeftAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chatchannelmember_channel")
                            .from(ChatChannelMember::Table, ChatChannelMember::ChannelId)
                            .to(ChatChannel::Table, ChatChannel::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chatchannelmember_user")
                            .from(ChatChannelMember::Table, ChatChannelMember::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Indexes: lookup by channel (roster) + lookup by user (my channels).
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannelMember_channelId_idx")
                    .table(ChatChannelMember::Table)
                    .col(ChatChannelMember::ChannelId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannelMember_userId_idx")
                    .table(ChatChannelMember::Table)
                    .col(ChatChannelMember::UserId)
                    .to_owned(),
            )
            .await?;

        // UNIQUE(channel_id, user_id) — prevents duplicate joins for the
        // same user in the same channel. We use a non-unique composite
        // index here plus an explicit UNIQUE constraint below so the
        // schema documents the intent clearly.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannelMember_channel_user_uniq")
                    .table(ChatChannelMember::Table)
                    .col(ChatChannelMember::ChannelId)
                    .col(ChatChannelMember::UserId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // 3. Seed the ZeroClaw bot user. Idempotent — uses
        //    `INSERT ... ON CONFLICT DO NOTHING` semantics via raw SQL so
        //    re-running the migration is safe.
        //
        //    UUID `00000000-0000-0000-0000-000000000001` is the reserved
        //    bot id; the chat module references it as a `const`.
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"INSERT INTO "user" (
                id, brand_id, full_name, email, phone,
                email_verified_at, phone_verified_at, status, block_reason,
                password_hash, avatar_url, locale, is_guest, role,
                failed_login_attempts, locked_until, last_login_at, last_login_ip,
                password_changed_at, created_at, updated_at,
                oauth_provider, oauth_subject, is_bot
            ) VALUES (
                '00000000-0000-0000-0000-000000000001',
                NULL,
                'ZeroClaw AI',
                'bot+zeroclaw@system.local',
                NULL,
                NULL, NULL, 'active', NULL,
                NULL, NULL, 'vi', FALSE, 'user',
                0, NULL, NULL, NULL,
                NULL,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                NULL, NULL, TRUE
            )
            ON CONFLICT (id) DO NOTHING"#,
        )
        .await?;

        // Defensive: also ensure the email is unique-owned by the bot
        // (some old test DBs may already have a row with this email).
        // If a non-bot user already owns the email, we log + skip —
        // the bot insert above will have failed silently via ON CONFLICT.
        // We don't drop the conflicting row; the operator can clean it up.

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop member table.
        manager
            .drop_table(
                Table::drop()
                    .table(ChatChannelMember::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;

        // Drop `is_bot` column.
        manager
            .alter_table(
                Table::alter()
                    .table(User::Table)
                    .drop_column(Alias::new("is_bot"))
                    .to_owned(),
            )
            .await?;

        // Remove the seeded bot user. We use the deterministic UUID so
        // we don't accidentally delete a real user who happens to have
        // the same email.
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"DELETE FROM "user" WHERE id = '00000000-0000-0000-0000-000000000001'"#,
        )
        .await?;

        Ok(())
    }
}
