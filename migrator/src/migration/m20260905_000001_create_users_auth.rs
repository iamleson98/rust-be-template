//! Identity & auth core tables.
//!
//! Tables (dependency order):
//!   1. `user`             — accounts (role: user | employee | admin; is_bot
//!      flags the NullClaw AI agent account; OAuth
//!      provider/subject columns inline from day one)
//!   2. `posts`            — demo posts authored by users
//!   3. `refresh_tokens`   — rotating refresh tokens (one active per session)
//!   4. `user_verification`— email/phone OTP verification codes
//!   5. `audit_log`        — actor/action audit trail (no FKs by design)
//!   6. `notification`     — per-user in-app notifications
//!
//! The first registered account is promoted to `admin` at runtime by
//! `AuthService::register` — no admin user is seeded here.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── user ─────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .col(pk_uuid(User::Id))
                    .col(uuid_null(User::BrandId))
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
                    // OAuth identity (facebook | google | twitter). A
                    // (provider, subject) pair maps to exactly one local
                    // account; email collisions link instead of duplicate.
                    .col(string_len_null(User::OauthProvider, 20))
                    .col(text_null(User::OauthSubject))
                    // Flags the NullClaw AI agent account — never counted
                    // as staff by presence/assignment logic.
                    .col(boolean(User::IsBot).default(false))
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("User_status_idx")
                    .table(User::Table)
                    .col(User::Status)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("User_brandId_idx")
                    .table(User::Table)
                    .col(User::BrandId)
                    .to_owned(),
            )
            .await?;
        // `GET /api/users` orders by created_at DESC — index the sort key.
        manager
            .create_index(
                Index::create()
                    .name("User_createdAt_idx")
                    .table(User::Table)
                    .col((User::CreatedAt, IndexOrder::Desc))
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("User_oauth_provider_subject_uniq")
                    .table(User::Table)
                    .col(User::OauthProvider)
                    .col(User::OauthSubject)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── posts ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Posts::Table)
                    .col(pk_uuid(Posts::Id))
                    .col(uuid(Posts::AuthorId))
                    .col(string_len(Posts::Title, 256))
                    .col(text(Posts::Body))
                    .col(timestamp(Posts::CreatedAt).default(Expr::current_timestamp()))
                    .col(timestamp(Posts::UpdatedAt).default(Expr::current_timestamp()))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_posts_author")
                            .from(Posts::Table, Posts::AuthorId)
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
                    .name("idx_posts_author")
                    .table(Posts::Table)
                    .col(Posts::AuthorId)
                    .to_owned(),
            )
            .await?;
        // `GET /api/posts` (unauthenticated) orders by created_at DESC.
        manager
            .create_index(
                Index::create()
                    .name("Posts_createdAt_idx")
                    .table(Posts::Table)
                    .col((Posts::CreatedAt, IndexOrder::Desc))
                    .to_owned(),
            )
            .await?;

        // ── refresh_tokens ───────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(RefreshTokens::Table)
                    .col(pk_uuid(RefreshTokens::Id))
                    .col(uuid(RefreshTokens::UserId))
                    .col(string_len(RefreshTokens::TokenHash, 128))
                    .col(timestamp(RefreshTokens::IssuedAt).default(Expr::current_timestamp()))
                    .col(timestamp(RefreshTokens::ExpiresAt))
                    .col(boolean(RefreshTokens::Revoked).default(false))
                    .col(string_null(RefreshTokens::UserAgent))
                    .col(string_null(RefreshTokens::Ip))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_refresh_tokens_user")
                            .from(RefreshTokens::Table, RefreshTokens::UserId)
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
                    .name("idx_refresh_tokens_hash")
                    .table(RefreshTokens::Table)
                    .col(RefreshTokens::TokenHash)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_refresh_tokens_user")
                    .table(RefreshTokens::Table)
                    .col(RefreshTokens::UserId)
                    .to_owned(),
            )
            .await?;

        // ── user_verification ────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(UserVerification::Table)
                    .col(pk_uuid(UserVerification::Id))
                    .col(uuid(UserVerification::UserId))
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
                    .name("UserVerification_userId_idx")
                    .table(UserVerification::Table)
                    .col(UserVerification::UserId)
                    .to_owned(),
            )
            .await?;

        // ── audit_log ────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(AuditLog::Table)
                    .col(pk_uuid(AuditLog::Id))
                    .col(string_len_null(AuditLog::ActorType, 50))
                    .col(uuid_null(AuditLog::ActorId))
                    .col(string_len(AuditLog::Action, 50))
                    .col(string_len_null(AuditLog::TargetType, 50))
                    .col(uuid_null(AuditLog::TargetId))
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
                    .name("AuditLog_createdAt_idx")
                    .table(AuditLog::Table)
                    .col(AuditLog::CreatedAt)
                    .to_owned(),
            )
            .await?;

        // ── notification ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Notification::Table)
                    .col(pk_uuid(Notification::Id))
                    .col(uuid(Notification::UserId))
                    .col(string_len(Notification::Type, 50))
                    .col(string_len_null(Notification::Title, 255))
                    .col(text_null(Notification::Body))
                    .col(text_null(Notification::Data))
                    .col(boolean(Notification::Read).default(false))
                    .col(text(Notification::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_notification_user")
                            .from(Notification::Table, Notification::UserId)
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
                    .name("Notification_userId_idx")
                    .table(Notification::Table)
                    .col(Notification::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("Notification_user_read_idx")
                    .table(Notification::Table)
                    .col(Notification::UserId)
                    .col(Notification::Read)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            Notification::Table.into_iden(),
            AuditLog::Table.into_iden(),
            UserVerification::Table.into_iden(),
            RefreshTokens::Table.into_iden(),
            Posts::Table.into_iden(),
            User::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

#[derive(DeriveIden)]
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
    OauthProvider,
    OauthSubject,
    IsBot,
}

#[derive(DeriveIden)]
enum Posts {
    Table,
    Id,
    AuthorId,
    Title,
    Body,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum RefreshTokens {
    Table,
    Id,
    UserId,
    TokenHash,
    IssuedAt,
    ExpiresAt,
    Revoked,
    UserAgent,
    Ip,
}

#[derive(DeriveIden)]
enum UserVerification {
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
enum AuditLog {
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

#[derive(DeriveIden)]
enum Notification {
    Table,
    Id,
    UserId,
    Type,
    Title,
    Body,
    Data,
    Read,
    CreatedAt,
}
