use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::{
    m20250101_000001_create_users::User, m20260809_013648_places_brands::Brand,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum ChatChannel {
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
pub enum ChatMessage {
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
pub enum ChatAssignment {
    Table,
    Id,
    ChannelId,
    EmployeeId,
    AssignedAt,
    UnassignedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ChatChannel
        manager
            .create_table(
                Table::create()
                    .table(ChatChannel::Table)
                    .if_not_exists()
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

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannel_userId_idx")
                    .table(ChatChannel::Table)
                    .col(ChatChannel::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannel_status_lastMessage_idx")
                    .table(ChatChannel::Table)
                    .col(ChatChannel::Status)
                    .col(ChatChannel::LastMessageAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannel_brandId_idx")
                    .table(ChatChannel::Table)
                    .col(ChatChannel::BrandId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatChannel_status_priority_lastMessageAt_idx")
                    .table(ChatChannel::Table)
                    .col(ChatChannel::Status)
                    .col(ChatChannel::Priority)
                    .col(ChatChannel::LastMessageAt)
                    .to_owned(),
            )
            .await?;

        // ChatMessage
        manager
            .create_table(
                Table::create()
                    .table(ChatMessage::Table)
                    .if_not_exists()
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

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatMessage_channelId_idx")
                    .table(ChatMessage::Table)
                    .col(ChatMessage::ChannelId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatMessage_channelId_createdAt_idx")
                    .table(ChatMessage::Table)
                    .col(ChatMessage::ChannelId)
                    .col(ChatMessage::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatMessage_clientMsgId_uniq")
                    .table(ChatMessage::Table)
                    .col(ChatMessage::ChannelId)
                    .col(ChatMessage::ClientMsgId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ChatAssignment
        manager
            .create_table(
                Table::create()
                    .table(ChatAssignment::Table)
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("ChatAssignment_channelId_idx")
                    .table(ChatAssignment::Table)
                    .col(ChatAssignment::ChannelId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatAssignment_employeeId_idx")
                    .table(ChatAssignment::Table)
                    .col(ChatAssignment::EmployeeId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("ChatAssignment_channel_active_uniq")
                    .table(ChatAssignment::Table)
                    .col(ChatAssignment::ChannelId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(ChatAssignment::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(ChatMessage::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ChatChannel::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}
