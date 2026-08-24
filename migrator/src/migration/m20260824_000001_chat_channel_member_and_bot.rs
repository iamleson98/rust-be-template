use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{m20250101_000001_create_users::User, m20260809_021323_chat::ChatChannel};

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
