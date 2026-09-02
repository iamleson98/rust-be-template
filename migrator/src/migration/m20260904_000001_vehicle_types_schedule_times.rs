//! Vehicle types (admin-managed catalog) + schedule point arrival times.
//!
//! - `vehicle_type`: a managed catalog of vehicle classes (limousine,
//!   sleeper, 11-seater, 29-seater, …) that admins create/update on the
//!   new "Loại xe" admin page. Seeded with the five codes the public
//!   search historically hardcoded, so existing `bus_layout.vehicle_type`
//!   strings keep resolving after the upgrade.
//! - `schedule.vehicle_type_id`: explicit FK from a schedule to its
//!   vehicle class (nullable — older rows fall back to resolving the
//!   type through their bus layout, preserving back-compat). `SetNull`
//!   on delete: removing a vehicle type never deletes schedules, it just
//!   clears the reference.
//!   ⚠ SQLite cannot `ALTER TABLE … ADD CONSTRAINT`, so the FK is only
//!   created on Postgres; on SQLite referential integrity is enforced by
//!   `AdminService` (the upsert path validates the id exists).
//! - `schedule_point.arrival_time`: optional `HH:MM` per pickup/drop
//!   point so an operator can publish when the vehicle reaches each stop.
//! - Seeds `admin:vehicle_types:read|write` permissions for the
//!   `employee` role, following the idempotent SELECT-then-INSERT pattern
//!   of `m20260902_000001_addresses_schedule_points`.

use sea_orm_migration::{prelude::*, schema::*};

use sea_orm::DatabaseBackend;

use crate::migration::m20260809_020540_schedules_trips_campaigns::Schedule;
use crate::migration::m20260902_000001_addresses_schedule_points::SchedulePoint;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum VehicleType {
    Table,
    Id,
    Code,
    Label,
    Description,
    TotalSeats,
    SortOrder,
    Status,
    CreatedAt,
    UpdatedAt,
}

/// Column added to `schedule` (separate Iden so the original Schedule
/// enum from the older migration stays untouched).
#[derive(DeriveIden)]
enum ScheduleVehicleType {
    VehicleTypeId,
}

/// Column added to `schedule_point` (separate Iden for the same reason).
#[derive(DeriveIden)]
enum SchedulePointArrivalTime {
    ArrivalTime,
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
        "admin:vehicle_types:read",
        "Admin: list vehicle types (schedule form picker)",
    ),
    (
        "admin:vehicle_types:write",
        "Admin: create/update/delete vehicle types",
    ),
];

/// Seed catalog matching the legacy `vehicle_type_label` codes so the
/// public search filters and the bus-layout fallback keep working.
/// `total_seats` is the typical seat count (informational; the concrete
/// layout on `bus_layout.total_seats` wins for seat maps).
const SEED_TYPES: &[(&str, &str, Option<i16>, i16)] = &[
    ("limousine", "Limousine", Some(11), 1),
    ("minivan", "Minivan", Some(16), 2),
    ("standard", "Ghế ngồi", Some(29), 3),
    ("semi_sleeper", "Giường nằm đơn", Some(34), 4),
    ("sleeper", "Giường nằm", Some(40), 5),
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── vehicle_type ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(VehicleType::Table)
                    .if_not_exists()
                    .col(pk_uuid(VehicleType::Id))
                    .col(string_len_uniq(VehicleType::Code, 60))
                    .col(string_len(VehicleType::Label, 120))
                    .col(text_null(VehicleType::Description))
                    .col(small_integer_null(VehicleType::TotalSeats))
                    .col(small_integer(VehicleType::SortOrder).default(0))
                    .col(string_len(VehicleType::Status, 20).default("active"))
                    .col(text(VehicleType::CreatedAt))
                    .col(text(VehicleType::UpdatedAt))
                    .to_owned(),
            )
            .await?;

        seed_vehicle_types(manager).await?;

        // ── schedule.vehicle_type_id ─────────────────────────────────
        manager
            .alter_table(
                Table::alter()
                    .table(Schedule::Table)
                    .add_column(uuid_null(ScheduleVehicleType::VehicleTypeId))
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("Schedule_vehicle_type_idx")
                    .table(Schedule::Table)
                    .col(ScheduleVehicleType::VehicleTypeId)
                    .to_owned(),
            )
            .await?;
        // FK only on Postgres — SQLite has no `ALTER TABLE ADD CONSTRAINT`
        // (integrity is validated in `AdminService` instead).
        if manager.get_connection().get_database_backend() == DatabaseBackend::Postgres {
            manager
                .get_connection()
                .execute_unprepared(
                    r#"ALTER TABLE "schedule"
                       ADD CONSTRAINT "fk_schedule_vehicle_type"
                       FOREIGN KEY ("vehicle_type_id") REFERENCES "vehicle_type"("id")
                       ON DELETE SET NULL ON UPDATE CASCADE"#,
                )
                .await?;
        }

        // ── schedule_point.arrival_time ──────────────────────────────
        manager
            .alter_table(
                Table::alter()
                    .table(SchedulePoint::Table)
                    .add_column(text_null(SchedulePointArrivalTime::ArrivalTime))
                    .to_owned(),
            )
            .await?;

        // ── RBAC permissions ─────────────────────────────────────────
        seed_permissions(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        // Raw SQL for the column drops: SQLite refuses DROP COLUMN while
        // the column is indexed (drop the index first), and the schedule
        // FK only exists on Postgres.
        match conn.get_database_backend() {
            DatabaseBackend::Sqlite => {
                conn.execute_unprepared(r#"DROP INDEX IF EXISTS "Schedule_vehicle_type_idx""#)
                    .await?;
            }
            DatabaseBackend::Postgres => {
                conn.execute_unprepared(
                    r#"ALTER TABLE "schedule" DROP CONSTRAINT IF EXISTS "fk_schedule_vehicle_type""#,
                )
                .await?;
            }
            _ => {}
        }
        conn.execute_unprepared(r#"ALTER TABLE "schedule_point" DROP COLUMN "arrival_time""#)
            .await?;
        conn.execute_unprepared(r#"ALTER TABLE "schedule" DROP COLUMN "vehicle_type_id""#)
            .await?;
        // CASCADE drops the schedule FK on Postgres.
        manager
            .drop_table(Table::drop().table(VehicleType::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}

/// Insert the default catalog rows (idempotent on `code`).
async fn seed_vehicle_types(manager: &SchemaManager<'_>) -> Result<(), DbErr> {
    use sea_orm::sea_query::{Expr, Query};

    let conn = manager.get_connection();
    let backend = conn.get_database_backend();
    let now = Expr::current_timestamp();

    for (code, label, seats, sort) in SEED_TYPES {
        let exists = Query::select()
            .column(VehicleType::Id)
            .from(VehicleType::Table)
            .and_where(Expr::col(VehicleType::Code).eq(*code))
            .limit(1)
            .to_owned();
        let exists = backend.build(&exists);
        if conn.query_one(exists).await?.is_some() {
            continue;
        }
        let insert = Query::insert()
            .into_table(VehicleType::Table)
            .columns([
                VehicleType::Id,
                VehicleType::Code,
                VehicleType::Label,
                VehicleType::TotalSeats,
                VehicleType::SortOrder,
                VehicleType::Status,
                VehicleType::CreatedAt,
                VehicleType::UpdatedAt,
            ])
            .values_panic([
                uuid::Uuid::new_v4().into(),
                (*code).into(),
                (*label).into(),
                (*seats).into(),
                (*sort).into(),
                "active".into(),
                now.clone().into(),
                now.clone().into(),
            ])
            .to_owned();
        manager.exec_stmt(insert).await?;
    }
    Ok(())
}

/// Idempotent permission seeding — SELECT first, INSERT only when missing,
/// then grant to the `employee` role (no-op when already granted). Mirrors
/// `m20260902_000001_addresses_schedule_points::seed_permissions` (high-level
/// `Query` API so placeholders work on both SQLite and Postgres).
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_codes_cover_the_legacy_label_map() {
        // The five codes `public_service::vehicle_type_label` knows must be
        // present so pre-existing bus_layout.vehicle_type strings resolve.
        for legacy in [
            "limousine",
            "sleeper",
            "semi_sleeper",
            "minivan",
            "standard",
        ] {
            assert!(
                SEED_TYPES.iter().any(|(code, ..)| *code == legacy),
                "legacy vehicle type {legacy:?} missing from the seed catalog"
            );
        }
    }
}
