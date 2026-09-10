//! Staff presence state — durable last-seen for the team board.
//!
//! Backs the "active state of users" feature: the live online/busy/
//! available registry stays in-process (the `presence` module's
//! DashMap — the hot cache), while this table is the durable backstop
//! written through a debounced journal so every UI can ALSO answer
//! "when was this staff member last active?" across restarts and
//! deploys.
//!
//! Design notes:
//!   * PK `user_id` — one row per staff member, upserted (never
//!     appended): presence is a STATE, not an event log.
//!   * `online` is the last durable online/offline flag. After a
//!     backend restart the in-memory cache is empty until sockets
//!     reconnect; this column is what lets the team board say
//!     "nobody online, last active 3 minutes ago" in that window
//!     instead of rendering an empty void.
//!   * `last_seen_at` is bumped (debounced) on every presence
//!     mutation and by a slow heartbeat sweep for long-online
//!     members — one tiny UPDATE per member per minute, not per
//!     socket event.
//!   * `name` / `role` / `brand_id` are denormalized so the offline
//!     roster renders without a JOIN (they are display-cached; the
//!     auth tables remain the source of truth).
//!   * Timestamps are RFC3339 TEXT, matching every other table in
//!     the schema (the rust-sql engine stores TEXT datetimes).

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(StaffPresenceState::Table)
                    .col(pk_uuid(StaffPresenceState::UserId))
                    .col(text(StaffPresenceState::Name))
                    .col(string_len(StaffPresenceState::Role, 20))
                    .col(uuid_null(StaffPresenceState::BrandId))
                    .col(integer(StaffPresenceState::Online).default(0))
                    .col(text(StaffPresenceState::LastSeenAt))
                    .col(text_null(StaffPresenceState::LastOnlineAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_staff_presence_state_user")
                            .from(StaffPresenceState::Table, StaffPresenceState::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(StaffPresenceState::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum StaffPresenceState {
    Table,
    UserId,
    Name,
    Role,
    BrandId,
    Online,
    LastSeenAt,
    LastOnlineAt,
}

/// Minimal reference to the table created by the users migration.
#[derive(DeriveIden)]
enum User {
    Table,
    Id,
}
