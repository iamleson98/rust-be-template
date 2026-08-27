use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20260809_021323_chat::{ChatChannel, ChatMessage};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum NullClawExchange {
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
                    .table(NullClawExchange::Table)
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("NullClawExchange_channel_idx")
                    .table(NullClawExchange::Table)
                    .col(NullClawExchange::ChannelId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(NullClawExchange::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
