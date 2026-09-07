//! Engagement & background jobs.
//!
//!   1. `wishlist_item`  — saved routes per user
//!   2. `price_alert`    — route price-drop alerts (phone-anchored;
//!      `user_id` is a TEXT UUID — nullable for legacy
//!      phone-only alerts, no FK by design)
//!   3. `scheduled_job`  — recurring job schedules (rows are seeded by
//!      `JobService::ensure_default_jobs` at server
//!      boot so the first `next_run_at` is relative to
//!      the first boot, NOT to migration time)
//!   4. `job_run`        — one row per job execution (queued → running →
//!      succeeded/failed)

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── wishlist_item ────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(WishlistItem::Table)
                    .col(pk_uuid(WishlistItem::Id))
                    .col(uuid(WishlistItem::UserId))
                    .col(uuid(WishlistItem::RouteId))
                    .col(text(WishlistItem::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_wishlist_user")
                            .from(WishlistItem::Table, WishlistItem::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_wishlist_route")
                            .from(WishlistItem::Table, WishlistItem::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("WishlistItem_userId_idx")
                    .table(WishlistItem::Table)
                    .col(WishlistItem::UserId)
                    .to_owned(),
            )
            .await?;
        // A route is saved at most once per user.
        manager
            .create_index(
                Index::create()
                    .name("WishlistItem_user_route_uniq")
                    .table(WishlistItem::Table)
                    .col(WishlistItem::UserId)
                    .col(WishlistItem::RouteId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── price_alert ──────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(PriceAlert::Table)
                    .col(pk_uuid(PriceAlert::Id))
                    .col(string_len(PriceAlert::Phone, 20))
                    .col(string_len_null(PriceAlert::Email, 255))
                    .col(string_len_null(PriceAlert::FromName, 255))
                    .col(string_len_null(PriceAlert::ToName, 255))
                    .col(uuid_null(PriceAlert::RouteId))
                    .col(integer_null(PriceAlert::TargetPrice))
                    .col(string_len(PriceAlert::Frequency, 10).default("daily"))
                    .col(string_len(PriceAlert::Status, 30).default("active"))
                    .col(text(PriceAlert::CreatedAt))
                    .col(text_null(PriceAlert::ExpiresAt))
                    // Owner (TEXT UUID, nullable for phone-only alerts).
                    .col(text_null(PriceAlert::UserId))
                    // When the alert last fired.
                    .col(text_null(PriceAlert::LastTriggeredAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_pricealert_route")
                            .from(PriceAlert::Table, PriceAlert::RouteId)
                            .to(Route::Table, Route::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        for (idx, col) in [
            ("PriceAlert_phone_idx", PriceAlert::Phone),
            ("PriceAlert_status_idx", PriceAlert::Status),
            ("PriceAlert_routeId_idx", PriceAlert::RouteId),
            // "My alerts" query filters by user_id.
            ("PriceAlert_userId_idx", PriceAlert::UserId),
        ] {
            manager
                .create_index(
                    Index::create()
                        .name(idx)
                        .table(PriceAlert::Table)
                        .col(col)
                        .to_owned(),
                )
                .await?;
        }

        // ── scheduled_job ────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(ScheduledJob::Table)
                    .col(pk_uuid(ScheduledJob::Id))
                    .col(string_len(ScheduledJob::JobType, 100))
                    .col(boolean(ScheduledJob::Enabled))
                    .col(small_integer(ScheduledJob::IntervalDays))
                    .col(small_integer(ScheduledJob::AtHour))
                    .col(small_integer(ScheduledJob::AtMinute))
                    .col(text_null(ScheduledJob::NextRunAt))
                    .col(text(ScheduledJob::CreatedAt))
                    .col(text(ScheduledJob::UpdatedAt))
                    .to_owned(),
            )
            .await?;

        // One schedule row per job type.
        manager
            .create_index(
                Index::create()
                    .name("ScheduledJob_job_type_uq")
                    .table(ScheduledJob::Table)
                    .col(ScheduledJob::JobType)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ── job_run ──────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(JobRun::Table)
                    .col(pk_uuid(JobRun::Id))
                    .col(string_len(JobRun::JobType, 100))
                    .col(string_len(JobRun::Status, 20))
                    .col(text_null(JobRun::Detail))
                    .col(text_null(JobRun::Error))
                    .col(text_null(JobRun::StartedAt))
                    .col(text_null(JobRun::FinishedAt))
                    .col(text(JobRun::CreatedAt))
                    .to_owned(),
            )
            .await?;

        // History lookup: "latest runs for job X" + "all active runs".
        manager
            .create_index(
                Index::create()
                    .name("JobRun_job_type_created_idx")
                    .table(JobRun::Table)
                    .col(JobRun::JobType)
                    .col(JobRun::CreatedAt)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("JobRun_status_idx")
                    .table(JobRun::Table)
                    .col(JobRun::Status)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            JobRun::Table.into_iden(),
            ScheduledJob::Table.into_iden(),
            PriceAlert::Table.into_iden(),
            WishlistItem::Table.into_iden(),
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
enum Route {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum WishlistItem {
    Table,
    Id,
    UserId,
    RouteId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum PriceAlert {
    Table,
    Id,
    Phone,
    Email,
    FromName,
    ToName,
    RouteId,
    TargetPrice,
    Frequency,
    Status,
    CreatedAt,
    ExpiresAt,
    UserId,
    LastTriggeredAt,
}

#[derive(DeriveIden)]
enum ScheduledJob {
    Table,
    Id,
    JobType,
    Enabled,
    IntervalDays,
    AtHour,
    AtMinute,
    NextRunAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum JobRun {
    Table,
    Id,
    JobType,
    Status,
    Detail,
    Error,
    StartedAt,
    FinishedAt,
    CreatedAt,
}
