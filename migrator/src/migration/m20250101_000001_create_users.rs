use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .if_not_exists()
                    .col(pk_uuid(User::Id)) // Use pk_uuid(User::Id) if you switch to UUID type
                    .col(text_null(User::BrandId))
                    .col(string_len(User::FullName, 255))
                    .col(string_len_uniq(User::Email, 255))
                    .col(text_null(User::Phone))
                    .col(text_null(User::EmailVerifiedAt))
                    .col(text_null(User::PhoneVerifiedAt))
                    .col(string_len(User::Status, 30).default("active"))
                    .col(text_null(User::BlockReason))
                    .col(string_len_null(User::PasswordHash, 255))
                    .col(string_len_null(User::AvatarUrl, 500))
                    .col(string_len(User::Locale, 10).default("vi"))
                    .col(boolean(User::IsGuest).default(false))
                    .col(string_len(User::Role, 30).default("user"))
                    .col(integer(User::FailedLoginAttempts).default(0))
                    .col(text_null(User::LockedUntil))
                    .col(text_null(User::LastLoginAt))
                    .col(string_len_null(User::LastLoginIp, 45))
                    .col(text_null(User::PasswordChangedAt))
                    .col(timestamp(User::CreatedAt).default(Expr::current_timestamp()))
                    .col(timestamp(User::UpdatedAt).default(Expr::current_timestamp()))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("User_status_idx")
                    .table(User::Table)
                    .col(User::Status)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("User_brandId_idx")
                    .table(User::Table)
                    .col(User::BrandId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(User::Table).to_owned())
            .await
    }
}

#[derive(Iden)]
pub enum User {
    Table,
    Id,
    BrandId,
    FullName,
    Email,
    Phone,
    EmailVerifiedAt,
    PhoneVerifiedAt,
    Status,
    BlockReason,
    PasswordHash,
    AvatarUrl,
    Locale,
    IsGuest,
    Role,
    FailedLoginAttempts,
    LockedUntil,
    LastLoginAt,
    LastLoginIp,
    PasswordChangedAt,
    CreatedAt,
    UpdatedAt,
}
