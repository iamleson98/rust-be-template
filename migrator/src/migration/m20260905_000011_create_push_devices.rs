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
//!
//! Deliberately NO foreign key on `user_id` — mirrors
//! `chat_assignment.employee_id`'s TEXT design: FCM must never block
//! call setup on a FK mismatch, and stale rows are pruned lazily via
//! the 404/410 UNREGISTERED response path in the FCM sender.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
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
                    .index(
                        Index::create()
                            .name("idx_push_device_user")
                            .col(PushDevice::UserId),
                    )
                    .index(
                        Index::create()
                            .name("idx_push_device_token")
                            .col(PushDevice::Token),
                    )
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
