//! Recurring (cron-style) job schedules + run history.
//!
//! - `scheduled_job`: one row per worker job type the scheduler should
//!   fire on a cadence ("every N days at HH:MM", wall-clock interpreted
//!   in the scheduler's timezone, default UTC+7). Rows are seeded by
//!   `JobService::ensure_default_jobs` at server boot — NOT here — so
//!   the first `next_run_at` is relative to the first boot rather than
//!   to migration time.
//! - `job_run`: one row per execution (queued → running → succeeded /
//!   failed), written by the scheduler (enqueue) and the job handler
//!   (lifecycle + progress JSON + error). Powers the admin cron-jobs
//!   page (status, next run, work time, history).
//! - Seeds `admin:cron-jobs:read|write` permissions for the `employee`
//!   role, following the idempotent SELECT-then-INSERT pattern of
//!   `m20260818_000002_seed_payment_perms` / `m20260902_000001`.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

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

// ── RBAC seeding (Iden enums) ─────────────────────────────────────────

#[allow(dead_code)]
#[derive(DeriveIden)]
enum Roles {
    Table,
    Id,
    Name,
}

#[derive(DeriveIden)]
enum Permissions {
    Table,
    Id,
    Name,
    Description,
    CreatedAt,
}

#[derive(DeriveIden)]
enum RolePermissions {
    Table,
    RoleId,
    PermissionId,
    AssignedAt,
}

const NEW_PERMS: &[(&str, &str)] = &[
    (
        "admin:cron-jobs:read",
        "Admin: view scheduled jobs, their status and run history",
    ),
    (
        "admin:cron-jobs:write",
        "Admin: trigger / reschedule / enable+disable scheduled jobs",
    ),
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── scheduled_job ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(ScheduledJob::Table)
                    .if_not_exists()
                    .col(pk_uuid(ScheduledJob::Id))
                    .col(string_len(ScheduledJob::JobType, 100))
                    .col(boolean(ScheduledJob::Enabled))
                    .col(integer(ScheduledJob::IntervalDays))
                    .col(integer(ScheduledJob::AtHour))
                    .col(integer(ScheduledJob::AtMinute))
                    .col(text_null(ScheduledJob::NextRunAt))
                    .col(text(ScheduledJob::CreatedAt))
                    .col(text(ScheduledJob::UpdatedAt))
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .unique()
                    .name("ScheduledJob_job_type_uq")
                    .table(ScheduledJob::Table)
                    .col(ScheduledJob::JobType)
                    .to_owned(),
            )
            .await?;

        // ── job_run ───────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(JobRun::Table)
                    .if_not_exists()
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
        // History lookup: "latest runs for job X" and "all active runs".
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
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
                    .if_not_exists()
                    .name("JobRun_status_idx")
                    .table(JobRun::Table)
                    .col(JobRun::Status)
                    .to_owned(),
            )
            .await?;

        // ── RBAC permissions ──────────────────────────────────────────
        seed_permissions(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(JobRun::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ScheduledJob::Table).to_owned())
            .await?;
        Ok(())
    }
}

/// Idempotent permission seeding — SELECT first, INSERT only when missing,
/// then grant to the `employee` role (no-op when already granted). Mirrors
/// `m20260902_000001` / `m20260818_000002` (high-level `Query` API so
/// placeholders work on both SQLite and Postgres).
async fn seed_permissions(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    use sea_orm::sea_query::{Expr, Query};

    let conn = manager.get_connection();
    let backend = conn.get_database_backend();

    let employee_role_id: Option<uuid::Uuid> = {
        let stmt = Query::select()
            .column(Roles::Id)
            .from(Roles::Table)
            .and_where(Expr::col(Roles::Name).eq("employee"))
            .limit(1)
            .to_owned();
        let stmt = backend.build(&stmt);
        let row = conn.query_one(stmt).await?;
        row.and_then(|r| r.try_get::<uuid::Uuid>("", "id").ok())
    };

    for (name, desc) in NEW_PERMS {
        let exists_stmt = Query::select()
            .column(Permissions::Id)
            .from(Permissions::Table)
            .and_where(Expr::col(Permissions::Name).eq(*name))
            .limit(1)
            .to_owned();
        let exists_stmt = backend.build(&exists_stmt);
        let existing = conn.query_one(exists_stmt).await?;
        let perm_id: uuid::Uuid = match existing {
            Some(row) => row.try_get("", "id")?,
            None => {
                let new_id = uuid::Uuid::new_v4();
                let insert_perm = Query::insert()
                    .into_table(Permissions::Table)
                    .columns([
                        Permissions::Id,
                        Permissions::Name,
                        Permissions::Description,
                        Permissions::CreatedAt,
                    ])
                    .values_panic([
                        new_id.into(),
                        (*name).into(),
                        (*desc).into(),
                        Expr::current_timestamp().into(),
                    ])
                    .to_owned();
                manager.exec_stmt(insert_perm).await?;
                new_id
            }
        };

        if let Some(role_id) = &employee_role_id {
            let grant_exists_stmt = Query::select()
                .column(RolePermissions::RoleId)
                .from(RolePermissions::Table)
                .and_where(Expr::col(RolePermissions::RoleId).eq(*role_id))
                .and_where(Expr::col(RolePermissions::PermissionId).eq(perm_id))
                .limit(1)
                .to_owned();
            let grant_exists_stmt = backend.build(&grant_exists_stmt);
            let already_granted = conn.query_one(grant_exists_stmt).await?.is_some();
            if !already_granted {
                let grant = Query::insert()
                    .into_table(RolePermissions::Table)
                    .columns([
                        RolePermissions::RoleId,
                        RolePermissions::PermissionId,
                        RolePermissions::AssignedAt,
                    ])
                    .values_panic([
                        (*role_id).into(),
                        perm_id.into(),
                        Expr::current_timestamp().into(),
                    ])
                    .to_owned();
                manager.exec_stmt(grant).await?;
            }
        }
    }

    Ok(())
}
