//! Push devices — FCM/APNs registration tokens per user.
//!
//! Backs the "ring even when the app is closed" flow: the audio-call
//! session manager relays every ring (initial + re-route) to the
//! agent's registered devices via FCM data messages, which wake the
//! app (Android) / trigger PushKit (iOS) even when the process is
//! dead. Tokens are registered by the client right after login.
//!
//! One row per (user, token); a user may hold several devices (phone +
//! tablet). `platform` is `android` / `ios` / `web`.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // NOTE: no inline `.index(...)` inside create_table — the
        // rust-sql engine's parser rejects inline INDEX table
        // constraints (they're a SQLite legacy extension; standard
        // SQL wants separate CREATE INDEX statements, which also keeps
        // the statement Postgres-compatible).
        manager
            .create_table(
                Table::create()
                    .table(PushDevice::Table)
                    .col(pk_uuid(PushDevice::Id))
                    .col(uuid(PushDevice::UserId))
                    .col(text(PushDevice::Token))
                    .col(string_len(PushDevice::Platform, 10).default("android"))
                    .col(text(PushDevice::CreatedAt))
                    .col(text_null(PushDevice::UpdatedAt))
                    .col(text_null(PushDevice::LastSeenAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_push_device_user")
                            .from(PushDevice::Table, PushDevice::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Lookup by owner (fan-out list on every ring).
        manager
            .create_index(
                Index::create()
                    .name("idx_push_device_user")
                    .table(PushDevice::Table)
                    .col(PushDevice::UserId)
                    .to_owned(),
            )
            .await?;

        // Token lookup (logout / rotation / prune by exact token).
        manager
            .create_index(
                Index::create()
                    .name("idx_push_device_token")
                    .table(PushDevice::Table)
                    .col(PushDevice::Token)
                    .to_owned(),
            )
            .await?;

        // One row per (user, token) — re-registering a known token
        // refreshes `updated_at` instead of duplicating.
        manager
            .create_index(
                Index::create()
                    .name("idx_push_device_user_token_unique")
                    .unique()
                    .table(PushDevice::Table)
                    .col(PushDevice::UserId)
                    .col(PushDevice::Token)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PushDevice::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum PushDevice {
    Table,
    Id,
    UserId,
    Token,
    Platform,
    CreatedAt,
    UpdatedAt,
    LastSeenAt,
}

/// Minimal reference to the table created by the users migration.
#[derive(DeriveIden)]
enum User {
    Table,
    Id,
}
