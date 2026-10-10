//! `background_job` — the worker queue, owned by migrations like every
//! other table.
//!
//! Until now the DB broker created an untracked `jobs` table itself at
//! boot (`CREATE TABLE IF NOT EXISTS`), so its shape never went through
//! review or versioning and schema tooling saw a table no migration
//! owned. Queue libraries that keep jobs in the app database (Oban,
//! River, Solid Queue) ship their tables as ordinary versioned
//! migrations; this does the same.
//!
//! One row per job that still has to run (or ran out of attempts):
//!
//! * `state` — `available` (waiting for `run_at`), `running` (leased by
//!   `locked_by` until `locked_until`; the worker renews the lease while
//!   it works, and an expired lease makes the job claimable again, so a
//!   crashed process loses nothing), `cancelled` (an operator stopped it
//!   while running; the worker notices at its next lease renewal), or
//!   `dead` (out of attempts — kept for inspection, with `last_error`).
//!   A job that succeeds is deleted.
//! * `attempt` — how many times a worker has started it.
//! * `unique_key` — at most one live job per `(kind, unique_key)`; NULLs
//!   never collide. Scheduled jobs use it so two app instances (or a
//!   click on "run now" during a scheduled run) cannot start the same
//!   job twice.
//!
//! Timestamps are ISO-8601 UTC text with millisecond precision (fixed
//! width, so text order is time order), like the rest of the schema.
//!
//! Upgrades drop the legacy `jobs` table.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(BackgroundJob::Table)
                    .col(pk_uuid(BackgroundJob::Id))
                    .col(string_len(BackgroundJob::Kind, 100))
                    .col(text(BackgroundJob::Args))
                    .col(string_len(BackgroundJob::State, 16))
                    .col(small_integer(BackgroundJob::Priority).default(0))
                    .col(integer(BackgroundJob::Attempt).default(0))
                    .col(text(BackgroundJob::RunAt))
                    .col(string_len_null(BackgroundJob::LockedBy, 200))
                    .col(text_null(BackgroundJob::LockedUntil))
                    .col(string_len_null(BackgroundJob::UniqueKey, 200))
                    .col(text_null(BackgroundJob::LastError))
                    .col(text(BackgroundJob::CreatedAt))
                    .col(text(BackgroundJob::UpdatedAt))
                    .to_owned(),
            )
            .await?;

        // The claim scan: available jobs by due time, expired leases.
        manager
            .create_index(
                Index::create()
                    .name("idx_background_job_state_run_at")
                    .table(BackgroundJob::Table)
                    .col(BackgroundJob::State)
                    .col(BackgroundJob::RunAt)
                    .to_owned(),
            )
            .await?;

        // De-duplication: one live job per (kind, unique_key).
        manager
            .create_index(
                Index::create()
                    .name("idx_background_job_kind_unique_key")
                    .unique()
                    .table(BackgroundJob::Table)
                    .col(BackgroundJob::Kind)
                    .col(BackgroundJob::UniqueKey)
                    .to_owned(),
            )
            .await?;

        // The legacy queue (created at runtime by the old broker) only
        // ever held run requests for scheduled jobs, which the scheduler
        // re-creates on its own; it goes.
        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("jobs"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(BackgroundJob::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum BackgroundJob {
    Table,
    Id,
    Kind,
    Args,
    State,
    Priority,
    Attempt,
    RunAt,
    LockedBy,
    LockedUntil,
    UniqueKey,
    LastError,
    CreatedAt,
    UpdatedAt,
}
