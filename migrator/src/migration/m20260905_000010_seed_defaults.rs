//! Seed default reference data.
//!
//! Runs LAST (after every table + permission-introducing migration) so
//! the full permission catalogue exists when grants are written.
//!
//! Seeds:
//!   1. Roles — `admin` / `employee` / `user`
//!   2. Permissions — the complete 30-permission catalogue used by the
//!      route handlers (`src/rbac/model.rs` is the code-side mirror)
//!   3. Grants:
//!        * admin    → ALL permissions
//!        * employee → everything except the admin-only governance set
//!        * user     → posts:read, posts:write, users:read
//!   4. Vehicle-type catalogue — the five legacy codes the public search
//!      historically hardcoded (limousine / minivan / standard /
//!      semi_sleeper / sleeper)
//!
//! NOT seeded here:
//!   * the admin ACCOUNT — the first registered user is promoted to
//!     `admin` at runtime by `AuthService::register`
//!   * the NullClaw bot account — created on first registration
//!   * `scheduled_job` rows — seeded at server boot by
//!     `JobService::ensure_default_jobs` so the first `next_run_at` is
//!     relative to the first boot, not migration time
//!
//! The migration runner records applied migrations in
//! `seaql_migrations`, so `up` executes exactly once — plain INSERTs
//! are safe. Uses the high-level sea-query API throughout so
//! placeholders translate correctly on SQLite AND Postgres.

use sea_orm_migration::prelude::*;
use uuid::Uuid;

#[derive(DeriveMigrationName)]
pub struct Migration;

// ── Seed data ───────────────────────────────────────────────────────────

/// (name, description) for the three roles.
const ROLES: &[(&str, &str)] = &[
    ("admin", "Full access — system administrator"),
    (
        "employee",
        "Operational staff — bookings, tickets, support chat/calls, promotions",
    ),
    ("user", "Standard customer"),
];

/// The complete permission catalogue. Keep in sync with
/// `src/rbac/model.rs` Permission constants and the route guards.
const PERMISSIONS: &[(&str, &str)] = &[
    // Users
    ("users:read", "Read user list and profiles"),
    ("users:write", "Create/update users"),
    ("users:delete", "Delete users"),
    // Posts
    ("posts:read", "Read posts"),
    ("posts:write", "Create/update posts"),
    ("posts:delete", "Delete posts"),
    // Brands
    ("admin:brands:read", "Admin: list/view brands"),
    ("admin:brands:write", "Admin: create/update/delete brands"),
    // Routes
    ("admin:routes:read", "Admin: list/view routes"),
    ("admin:routes:write", "Admin: create/update/delete routes"),
    // Schedules
    ("admin:schedules:read", "Admin: list/view schedules"),
    (
        "admin:schedules:write",
        "Admin: create/update/delete schedules",
    ),
    // Addresses
    (
        "admin:addresses:read",
        "Admin: list brand addresses (schedule point picker)",
    ),
    (
        "admin:addresses:write",
        "Admin: create/update/delete brand addresses",
    ),
    // Scheduled jobs
    (
        "admin:cron-jobs:read",
        "Admin: view scheduled jobs, their status and run history",
    ),
    (
        "admin:cron-jobs:write",
        "Admin: trigger / reschedule / enable+disable scheduled jobs",
    ),
    // Pickup points
    ("admin:pickup_points:read", "Admin: list/view pickup points"),
    (
        "admin:pickup_points:write",
        "Admin: create/update/delete pickup points",
    ),
    // Bus layouts
    ("admin:bus_layouts:read", "Admin: list bus layouts"),
    // Vehicle types
    (
        "admin:vehicle_types:read",
        "Admin: list vehicle types (schedule form picker)",
    ),
    (
        "admin:vehicle_types:write",
        "Admin: create/update/delete vehicle types",
    ),
    // Reviews
    (
        "admin:reviews:moderate",
        "Admin: moderate reviews (approve/reject/delete)",
    ),
    // Bookings
    ("admin:bookings:read", "Admin: list/view bookings"),
    ("admin:bookings:write", "Admin: update booking status"),
    // Payments
    ("admin:payments:read", "Admin: list/view payments"),
    (
        "admin:payments:write",
        "Admin: update payment status, mark COD collected",
    ),
    // Stats + export
    ("admin:stats:read", "Admin: view booking statistics"),
    ("admin:export", "Admin: export bookings as CSV"),
    // NullClaw AI exchange audit log (contains customer PII)
    (
        "admin:nullclaw:read",
        "Admin: view NullClaw AI exchange audit log",
    ),
    // Role governance
    (
        "admin:users:manage-roles",
        "Admin: grant/revoke user, employee and admin roles",
    ),
];

/// Permissions reserved for admins — NOT granted to `employee`.
const ADMIN_ONLY_PERMS: &[&str] = &[
    "users:write",
    "users:delete",
    "admin:users:manage-roles",
    "admin:cron-jobs:read",
    "admin:cron-jobs:write",
    "admin:nullclaw:read",
    "admin:export",
];

/// Permissions granted to the `user` (customer) role.
const USER_PERMS: &[&str] = &["posts:read", "posts:write", "users:read"];

/// Vehicle-type catalogue: (code, label, typical seat count, sort order).
/// Matches the legacy `vehicle_type_label` codes so any bus-layout
/// `vehicle_type` strings keep resolving. `total_seats` is informational;
/// the concrete `bus_layout.total_seats` wins for seat maps.
const VEHICLE_TYPES: &[(&str, &str, i16, i16)] = &[
    ("limousine", "Limousine", 11, 1),
    ("minivan", "Minivan", 16, 2),
    ("standard", "Ghế ngồi", 29, 3),
    ("semi_sleeper", "Giường nằm đơn", 34, 4),
    ("sleeper", "Giường nằm", 40, 5),
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::Expr;

        // ── 1. Roles ─────────────────────────────────────────────────
        let mut role_ids: Vec<(Uuid, &str)> = Vec::with_capacity(ROLES.len());
        for (name, desc) in ROLES {
            let id = Uuid::new_v4();
            role_ids.push((id, name));
            let stmt = Query::insert()
                .into_table(Roles::Table)
                .columns([Roles::Id, Roles::Name, Roles::Description, Roles::CreatedAt])
                .values_panic([
                    id.into(),
                    (*name).into(),
                    (*desc).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }
        let role_id = |name: &str| -> Uuid {
            role_ids
                .iter()
                .find(|(_, n)| *n == name)
                .map(|(id, _)| *id)
                .expect("role name present in ROLES")
        };

        // ── 2. Permissions ───────────────────────────────────────────
        let mut perm_ids: Vec<(Uuid, &str)> = Vec::with_capacity(PERMISSIONS.len());
        for (name, desc) in PERMISSIONS {
            let id = Uuid::new_v4();
            perm_ids.push((id, name));
            let stmt = Query::insert()
                .into_table(Permissions::Table)
                .columns([
                    Permissions::Id,
                    Permissions::Name,
                    Permissions::Description,
                    Permissions::CreatedAt,
                ])
                .values_panic([
                    id.into(),
                    (*name).into(),
                    (*desc).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        // ── 3. Grants ────────────────────────────────────────────────
        let grant = |role: &str, perm: &str| -> Option<(Uuid, Uuid)> {
            let r = role_id(role);
            perm_ids
                .iter()
                .find(|(_, n)| *n == perm)
                .map(|(p, _)| (r, *p))
        };

        // admin → every permission.
        for (perm_id, _) in &perm_ids {
            let stmt = Query::insert()
                .into_table(RolePermissions::Table)
                .columns([
                    RolePermissions::RoleId,
                    RolePermissions::PermissionId,
                    RolePermissions::AssignedAt,
                ])
                .values_panic([
                    role_id("admin").into(),
                    (*perm_id).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        // employee → every permission except the admin-only set.
        for (perm_id, name) in &perm_ids {
            if ADMIN_ONLY_PERMS.contains(name) {
                continue;
            }
            let stmt = Query::insert()
                .into_table(RolePermissions::Table)
                .columns([
                    RolePermissions::RoleId,
                    RolePermissions::PermissionId,
                    RolePermissions::AssignedAt,
                ])
                .values_panic([
                    role_id("employee").into(),
                    (*perm_id).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        // user → the customer subset.
        for (role_id_value, perm_id) in USER_PERMS.iter().filter_map(|p| grant("user", p)) {
            let stmt = Query::insert()
                .into_table(RolePermissions::Table)
                .columns([
                    RolePermissions::RoleId,
                    RolePermissions::PermissionId,
                    RolePermissions::AssignedAt,
                ])
                .values_panic([
                    role_id_value.into(),
                    perm_id.into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        // ── 4. Vehicle-type catalogue ────────────────────────────────
        for (code, label, seats, sort) in VEHICLE_TYPES {
            let stmt = Query::insert()
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
                    Uuid::new_v4().into(),
                    (*code).into(),
                    (*label).into(),
                    (*seats).into(),
                    (*sort).into(),
                    "active".into(),
                    Expr::current_timestamp().into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::Expr;

        // Deleting the roles/permissions cascades to role_permissions
        // via the FK on_delete rules. Vehicle-type rows go by code.
        let stmt = Query::delete()
            .from_table(VehicleType::Table)
            .and_where(
                Expr::col(VehicleType::Code)
                    .is_in(VEHICLE_TYPES.iter().map(|(c, ..)| *c).collect::<Vec<_>>()),
            )
            .to_owned();
        manager.exec_stmt(stmt).await?;

        let stmt = Query::delete()
            .from_table(Permissions::Table)
            .and_where(
                Expr::col(Permissions::Name)
                    .is_in(PERMISSIONS.iter().map(|(n, _)| *n).collect::<Vec<_>>()),
            )
            .to_owned();
        manager.exec_stmt(stmt).await?;

        let stmt = Query::delete()
            .from_table(Roles::Table)
            .and_where(
                Expr::col(Roles::Name).is_in(ROLES.iter().map(|(n, _)| *n).collect::<Vec<_>>()),
            )
            .to_owned();
        manager.exec_stmt(stmt).await?;

        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

#[derive(DeriveIden)]
enum Roles {
    Table,
    Id,
    Name,
    Description,
    CreatedAt,
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

#[derive(DeriveIden)]
enum VehicleType {
    Table,
    Id,
    Code,
    Label,
    TotalSeats,
    SortOrder,
    Status,
    CreatedAt,
    UpdatedAt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_admin_only_perm_is_in_the_catalogue() {
        for p in ADMIN_ONLY_PERMS {
            assert!(
                PERMISSIONS.iter().any(|(name, _)| name == p),
                "ADMIN_ONLY_PERMS entry {p:?} missing from PERMISSIONS"
            );
        }
    }

    #[test]
    fn every_user_perm_is_in_the_catalogue() {
        for p in USER_PERMS {
            assert!(
                PERMISSIONS.iter().any(|(name, _)| name == p),
                "USER_PERMS entry {p:?} missing from PERMISSIONS"
            );
        }
    }

    #[test]
    fn employee_excludes_admin_only_and_includes_the_rest() {
        // The employee grant loop skips exactly the admin-only set.
        let employee_grants: Vec<&str> = PERMISSIONS
            .iter()
            .map(|(n, _)| *n)
            .filter(|n| !ADMIN_ONLY_PERMS.contains(n))
            .collect();
        // Spot-check the operational set an employee needs.
        for needed in [
            "admin:bookings:read",
            "admin:bookings:write",
            "admin:payments:read",
            "admin:reviews:moderate",
            "admin:brands:write",
        ] {
            assert!(employee_grants.contains(&needed), "{needed} missing");
        }
        // And governance perms stay out.
        for forbidden in ADMIN_ONLY_PERMS {
            assert!(!employee_grants.contains(forbidden), "{forbidden} leaked");
        }
    }

    #[test]
    fn vehicle_type_codes_cover_the_legacy_label_map() {
        // The codes `public_service::vehicle_type_label` knows must be
        // present so bus_layout.vehicle_type strings keep resolving.
        for legacy in [
            "limousine",
            "sleeper",
            "semi_sleeper",
            "minivan",
            "standard",
        ] {
            assert!(
                VEHICLE_TYPES.iter().any(|(code, ..)| *code == legacy),
                "legacy vehicle type {legacy:?} missing from the seed catalogue"
            );
        }
    }

    #[test]
    fn roles_are_exactly_the_three_roles() {
        let mut names: Vec<&str> = ROLES.iter().map(|(n, _)| *n).collect();
        names.sort_unstable();
        assert_eq!(names, vec!["admin", "employee", "user"]);
    }
}
