use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20250101_000001_create_users::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
pub enum UserVerification {
    Table,
    Id,
    UserId,
    Channel,
    Target,
    CodeHash,
    Purpose,
    Attempts,
    ExpiresAt,
    ConsumedAt,
}

#[derive(DeriveIden)]
pub enum AuditLog {
    Table,
    Id,
    ActorType,
    ActorId,
    Action,
    TargetType,
    TargetId,
    Metadata,
    Ip,
    UserAgent,
    CreatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserVerification::Table)
                    .if_not_exists()
                    .col(pk_uuid(UserVerification::Id))
                    .col(text(UserVerification::UserId))
                    .col(string_len(UserVerification::Channel, 10))
                    .col(string_len(UserVerification::Target, 255))
                    .col(string_len(UserVerification::CodeHash, 255))
                    .col(string_len(UserVerification::Purpose, 30))
                    .col(integer(UserVerification::Attempts).default(0))
                    .col(text(UserVerification::ExpiresAt))
                    .col(text_null(UserVerification::ConsumedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_userverification_user")
                            .from(UserVerification::Table, UserVerification::UserId)
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
                    .if_not_exists()
                    .name("UserVerification_target_purpose_idx")
                    .table(UserVerification::Table)
                    .col(UserVerification::Target)
                    .col(UserVerification::Purpose)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("UserVerification_userId_idx")
                    .table(UserVerification::Table)
                    .col(UserVerification::UserId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(AuditLog::Table)
                    .if_not_exists()
                    .col(pk_uuid(AuditLog::Id))
                    .col(string_len_null(AuditLog::ActorType, 50))
                    .col(text_null(AuditLog::ActorId))
                    .col(string_len(AuditLog::Action, 50))
                    .col(string_len_null(AuditLog::TargetType, 50))
                    .col(text_null(AuditLog::TargetId))
                    .col(text_null(AuditLog::Metadata))
                    .col(string_len_null(AuditLog::Ip, 45))
                    .col(text_null(AuditLog::UserAgent))
                    .col(text(AuditLog::CreatedAt))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("AuditLog_actor_idx")
                    .table(AuditLog::Table)
                    .col(AuditLog::ActorType)
                    .col(AuditLog::ActorId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("AuditLog_target_idx")
                    .table(AuditLog::Table)
                    .col(AuditLog::TargetType)
                    .col(AuditLog::TargetId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("AuditLog_createdAt_idx")
                    .table(AuditLog::Table)
                    .col(AuditLog::CreatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AuditLog::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(UserVerification::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
