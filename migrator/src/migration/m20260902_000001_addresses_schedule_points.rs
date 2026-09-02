//! Brand-owned addresses + ordered schedule points.
//!
//! - `address`: a named geographic point (id / name / lat / lon / hierarchy)
//!   that belongs to exactly one transport brand (`brand_id` FK). Deleting
//!   the brand cascades to its addresses.
//! - `schedule_point`: an ordered address sequence for a schedule —
//!   first row = departure pickup, last row = final drop, middle rows are
//!   midway pickup/drop stops. Deleting the schedule cascades to its
//!   points; an address referenced by any point is protected (`Restrict`).
//! - Seeds `admin:addresses:read|write` permissions for the `employee`
//!   role, following the idempotent SELECT-then-INSERT pattern of
//!   `m20260818_000002_seed_payment_perms` (safe on fresh + existing DBs).

use sea_orm_migration::{prelude::*, schema::*};

use crate::migration::m20260809_013648_places_brands::Brand;
use crate::migration::m20260809_020540_schedules_trips_campaigns::Schedule;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum Address {
    Table,
    Id,
    BrandId,
    Name,
    Address,
    Lat,
    Lon,
    Province,
    District,
    Ward,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SchedulePoint {
    Table,
    Id,
    ScheduleId,
    AddressId,
    StopOrder,
    Kind,
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
        "admin:addresses:read",
        "Admin: list brand addresses (schedule point picker)",
    ),
    (
        "admin:addresses:write",
        "Admin: create/update/delete brand addresses",
    ),
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── address ───────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Address::Table)
                    .if_not_exists()
                    .col(pk_uuid(Address::Id))
                    .col(uuid(Address::BrandId))
                    .col(string_len(Address::Name, 255))
                    .col(text_null(Address::Address))
                    .col(double(Address::Lat))
                    .col(double(Address::Lon))
                    .col(text_null(Address::Province))
                    .col(text_null(Address::District))
                    .col(text_null(Address::Ward))
                    .col(text(Address::CreatedAt))
                    .col(text(Address::UpdatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_address_brand")
                            .from(Address::Table, Address::BrandId)
                            .to(Brand::Table, Brand::Id)
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
                    .name("Address_brand_idx")
                    .table(Address::Table)
                    .col(Address::BrandId)
                    .to_owned(),
            )
            .await?;

        // ── schedule_point ────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(SchedulePoint::Table)
                    .if_not_exists()
                    .col(pk_uuid(SchedulePoint::Id))
                    .col(uuid(SchedulePoint::ScheduleId))
                    .col(uuid(SchedulePoint::AddressId))
                    .col(integer(SchedulePoint::StopOrder).default(0))
                    .col(string_len(SchedulePoint::Kind, 20))
                    .col(text(SchedulePoint::CreatedAt))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_point_schedule")
                            .from(SchedulePoint::Table, SchedulePoint::ScheduleId)
                            .to(Schedule::Table, Schedule::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_schedule_point_address")
                            .from(SchedulePoint::Table, SchedulePoint::AddressId)
                            .to(Address::Table, Address::Id)
                            .on_delete(ForeignKeyAction::Restrict)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SchedulePoint_schedule_idx")
                    .table(SchedulePoint::Table)
                    .col(SchedulePoint::ScheduleId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("SchedulePoint_address_idx")
                    .table(SchedulePoint::Table)
                    .col(SchedulePoint::AddressId)
                    .to_owned(),
            )
            .await?;

        // ── RBAC permissions ──────────────────────────────────────────
        seed_permissions(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SchedulePoint::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(Address::Table).cascade().to_owned())
            .await?;
        Ok(())
    }
}

/// Idempotent permission seeding — SELECT first, INSERT only when missing,
/// then grant to the `employee` role (no-op when already granted). Mirrors
/// `m20260818_000002_seed_payment_perms` (high-level `Query` API so
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
