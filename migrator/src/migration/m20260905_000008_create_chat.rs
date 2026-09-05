//! Support chat — channels, messages, staff assignment, membership and
//! the NullClaw AI exchange audit log.
//!
//!   1. `chat_channel`         — one support conversation per customer
//!   2. `chat_message`          — messages (user | employee | bot senders)
//!   3. `chat_assignment`       — which employee/admin currently owns a
//!                                channel (one active row per channel;
//!                                `employee_id` is TEXT by design — it
//!                                also stores historical/bot ids without
//!                                FK enforcement)
//!   4. `chat_channel_member`   — channel roster (customer + staff + bot)
//!   5. `nullclaw_exchange`     — AI prompt/completion audit rows
//!

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── chat_channel ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(ChatChannel::Table)
                    .col(pk_uuid(ChatChannel::Id))
                    .col(uuid(ChatChannel::UserId))
                    .col(uuid_null(ChatChannel::BrandId))
                    .col(string_len_null(ChatChannel::Topic, 255))
                    .col(string_len(ChatChannel::Status, 30).default("open"))
                    .col(string_len(ChatChannel::Priority, 10).default("normal"))
                    .col(text_null(ChatChannel::LastMessageAt))
                    .col(string_len_null(ChatChannel::LastMessagePreview, 500))
                    .col(integer(ChatChannel::UnreadUser).default(0))
                    .col(integer(ChatChannel::UnreadEmployee).default(0))
                    .col(text(ChatChannel::CreatedAt))
                    .col(text_null(ChatChannel::ClosedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chatchannel_user")
                            .from(ChatChannel::Table, ChatChannel::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chatchannel_brand")
                            .from(ChatChannel::Table, ChatChannel::BrandId)
                            .to(Brand::Table, Brand::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        for (idx, cols) in [
            ("ChatChannel_userId_idx", vec![ChatChannel::UserId]),
            (
                "ChatChannel_status_lastMessage_idx",
                vec![ChatChannel::Status, ChatChannel::LastMessageAt],
            ),
            ("ChatChannel_brandId_idx", vec![ChatChannel::BrandId]),
            (
                "ChatChannel_status_priority_lastMessageAt_idx",
                vec![
                    ChatChannel::Status,
                    ChatChannel::Priority,
                    ChatChannel::LastMessageAt,
                ],
            ),
        ] {
            let mut index = Index::create();
            index.name(idx).table(ChatChannel::Table);
            for col in cols {
                index.col(col);
            }
            manager.create_index(index.to_owned()).await?;
        }

        // ── chat_message ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(ChatMessage::Table)
                    .col(pk_uuid(ChatMessage::Id))
                    .col(uuid(ChatMessage::ChannelId))
                    .col(string_len(ChatMessage::SenderType, 20))
                    .col(uuid_null(ChatMessage::SenderId))
                    .col(text_null(ChatMessage::Content))
                    .col(string_len(ChatMessage::Kind, 20).default("text"))
                    .col(text_null(ChatMessage::Attachments))
                    .col(string_len(ChatMessage::Status, 20).default("sent"))
                    .col(string_len_null(ChatMessage::ClientMsgId, 100))
                    .col(text(ChatMessage::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chatmessage_channel")
                            .from(ChatMessage::Table, ChatMessage::ChannelId)
                            .to(ChatChannel::Table, ChatChannel::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        for (idx, cols) in [
            ("ChatMessage_channelId_idx", vec![ChatMessage::ChannelId]),
            (
                "ChatMessage_channelId_createdAt_idx",
                vec![ChatMessage::ChannelId, ChatMessage::CreatedAt],
            ),
            // `avg_first_response_time_secs` metric filters by
            // sender_type — index it instead of scanning every row.
            ("ChatMessage_senderType_idx", vec![ChatMessage::SenderType]),
        ] {
            let mut index = Index::create();
            index.name(idx).table(ChatMessage::Table);
            for col in cols {
                index.col(col);
            }
            manager.create_index(index.to_owned()).await?;
        }
        // Client-side dedup: one row per (channel, client_msg_id).
        manager
            .create_index(
                Index::create()
                    .name("ChatMessage_clientMsgId_uniq")
                    .table(ChatMessage::Table)
                    .col(ChatMessage::ChannelId)
                    .col(ChatMessage::ClientMsgId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── chat_assignment ──────────────────────────────────────────
        // One active assignment row per channel; releasing sets
        // `unassigned_at` and a new row is inserted by the next claim.
        manager
            .create_table(
                Table::create()
                    .table(ChatAssignment::Table)
                    .col(pk_uuid(ChatAssignment::Id))
                    .col(uuid(ChatAssignment::ChannelId))
                    .col(text_null(ChatAssignment::EmployeeId))
                    .col(text(ChatAssignment::AssignedAt))
                    .col(text_null(ChatAssignment::UnassignedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_chatassignment_channel")
                            .from(ChatAssignment::Table, ChatAssignment::ChannelId)
                            .to(ChatChannel::Table, ChatChannel::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("ChatAssignment_channelId_idx")
                    .table(ChatAssignment::Table)
                    .col(ChatAssignment::ChannelId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("ChatAssignment_employeeId_idx")
                    .table(ChatAssignment::Table)
                    .col(ChatAssignment::EmployeeId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("ChatAssignment_channel_active_uniq")
                    .table(ChatAssignment::Table)
                    .col(ChatAssignment::ChannelId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── chat_channel_member ──────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(ChatChannelMember::Table)
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

        manager
            .create_index(
                Index::create()
                    .name("ChatChannelMember_channelId_idx")
                    .table(ChatChannelMember::Table)
                    .col(ChatChannelMember::ChannelId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("ChatChannelMember_userId_idx")
                    .table(ChatChannelMember::Table)
                    .col(ChatChannelMember::UserId)
                    .to_owned(),
            )
            .await?;
        // A user joins a channel at most once.
        manager
            .create_index(
                Index::create()
                    .name("ChatChannelMember_channel_user_uniq")
                    .table(ChatChannelMember::Table)
                    .col(ChatChannelMember::ChannelId)
                    .col(ChatChannelMember::UserId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── nullclaw_exchange ────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(NullClawExchange::Table)
                    .col(pk_uuid(NullClawExchange::Id))
                    .col(uuid_null(NullClawExchange::ChannelId))
                    .col(uuid_null(NullClawExchange::UserMessageId))
                    .col(uuid_null(NullClawExchange::AssistantMessageId))
                    .col(text_null(NullClawExchange::Prompt))
                    .col(text_null(NullClawExchange::Completion))
                    .col(string_len_null(NullClawExchange::Model, 50))
                    .col(big_integer_null(NullClawExchange::LatencyMs))
                    .col(boolean(NullClawExchange::HandoffToHuman).default(false))
                    .col(text(NullClawExchange::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_nullclaw_channel")
                            .from(NullClawExchange::Table, NullClawExchange::ChannelId)
                            .to(ChatChannel::Table, ChatChannel::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_nullclaw_user_msg")
                            .from(NullClawExchange::Table, NullClawExchange::UserMessageId)
                            .to(ChatMessage::Table, ChatMessage::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_nullclaw_assistant_msg")
                            .from(
                                NullClawExchange::Table,
                                NullClawExchange::AssistantMessageId,
                            )
                            .to(ChatMessage::Table, ChatMessage::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("NullClawExchange_channel_idx")
                    .table(NullClawExchange::Table)
                    .col(NullClawExchange::ChannelId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            NullClawExchange::Table.into_iden(),
            ChatChannelMember::Table.into_iden(),
            ChatAssignment::Table.into_iden(),
            ChatMessage::Table.into_iden(),
            ChatChannel::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

/// Minimal references to tables created by earlier migrations — keeps
/// this migration self-contained.
#[derive(DeriveIden)]
enum User {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Brand {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum ChatChannel {
    Table,
    Id,
    UserId,
    BrandId,
    Topic,
    Status,
    Priority,
    LastMessageAt,
    LastMessagePreview,
    UnreadUser,
    UnreadEmployee,
    CreatedAt,
    ClosedAt,
}

#[derive(DeriveIden)]
enum ChatMessage {
    Table,
    Id,
    ChannelId,
    SenderType,
    SenderId,
    Content,
    Kind,
    Attachments,
    Status,
    ClientMsgId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum ChatAssignment {
    Table,
    Id,
    ChannelId,
    EmployeeId,
    AssignedAt,
    UnassignedAt,
}

#[derive(DeriveIden)]
enum ChatChannelMember {
    Table,
    Id,
    ChannelId,
    UserId,
    Role,
    JoinedAt,
    LeftAt,
}

#[derive(DeriveIden)]
enum NullClawExchange {
    Table,
    Id,
    ChannelId,
    UserMessageId,
    AssistantMessageId,
    Prompt,
    Completion,
    Model,
    LatencyMs,
    HandoffToHuman,
    CreatedAt,
}
