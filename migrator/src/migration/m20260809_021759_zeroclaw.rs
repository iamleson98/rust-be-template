use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20260809_021323_chat::{ChatChannel, ChatMessage};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum ZeroClawExchange {
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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ZeroClawExchange::Table)
                    .if_not_exists()
                    .col(pk_uuid(ZeroClawExchange::Id))
                    .col(text_null(ZeroClawExchange::ChannelId))
                    .col(text_null(ZeroClawExchange::UserMessageId))
                    .col(text_null(ZeroClawExchange::AssistantMessageId))
                    .col(text_null(ZeroClawExchange::Prompt))
                    .col(text_null(ZeroClawExchange::Completion))
                    .col(string_len_null(ZeroClawExchange::Model, 50))
                    .col(big_integer_null(ZeroClawExchange::LatencyMs))
                    .col(boolean(ZeroClawExchange::HandoffToHuman).default(false))
                    .col(text(ZeroClawExchange::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_zeroclaw_channel")
                            .from(ZeroClawExchange::Table, ZeroClawExchange::ChannelId)
                            .to(ChatChannel::Table, ChatChannel::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_zeroclaw_user_msg")
                            .from(ZeroClawExchange::Table, ZeroClawExchange::UserMessageId)
                            .to(ChatMessage::Table, ChatMessage::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_zeroclaw_assistant_msg")
                            .from(
                                ZeroClawExchange::Table,
                                ZeroClawExchange::AssistantMessageId,
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
                    .if_not_exists()
                    .name("ZeroClawExchange_channel_idx")
                    .table(ZeroClawExchange::Table)
                    .col(ZeroClawExchange::ChannelId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(ZeroClawExchange::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
