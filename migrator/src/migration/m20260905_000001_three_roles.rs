//! Three-role RBAC split: `admin` / `employee` / `user`.
//!
//! Business rules implemented here (user spec):
//!   - **admin** — ALL permissions. The first registered account is the
//!     admin. On existing databases we promote the first human employee
//!     (the bootstrap account) to `admin`.
//!   - **employee** — operational staff: booking data, tickets, support
//!     chat/calls, promotions + sale programs. Keeps every operational
//!     permission but loses the admin-only governance set.
//!   - **user** — customers (book trips, feedback, ticket status). Not
//!     touched by this migration.
//!
//! Admin-only permission set (revoked from `employee`, granted to `admin`):
//!   - `users:write`, `users:delete` (account governance)
//!   - `admin:users:manage-roles` (NEW — grant/revoke roles)
//!   - `admin:cron-jobs:read`, `admin:cron-jobs:write` (system jobs)
//!   - `admin:nullclaw:read` (AI audit log, contains customer PII)
//!   - `admin:export` (bulk data export)
//!
//! Also normalises the NullClaw bot account (`is_bot = true`) down to the
//! `user` role — it was historically created with the first-user's role.
//!
//! Idempotent: every step SELECTs before INSERT/DELETE so fresh databases
//! (where the seed migration already ran with the new shape) and existing
//! databases converge to the same state. Uses the high-level sea-query
//! API so placeholders translate correctly on SQLite AND Postgres.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[allow(dead_code)]
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
enum UserRoles {
    Table,
    UserId,
    RoleId,
    AssignedAt,
}

#[derive(DeriveIden)]
enum User {
    Table,
    Id,
    Role,
    IsBot,
    CreatedAt,
}

/// Permissions reserved for admins (revoked from the employee role).
const ADMIN_ONLY_PERMS: &[&str] = &[
    "users:write",
    "users:delete",
    "admin:users:manage-roles",
    "admin:cron-jobs:read",
    "admin:cron-jobs:write",
    "admin:nullclaw:read",
    "admin:export",
];

/// New permissions introduced by this migration.
const NEW_PERMS: &[(&str, &str)] = &[(
    "admin:users:manage-roles",
    "Admin: grant/revoke user, employee and admin roles",
)];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::{Expr, Query};

        let conn = manager.get_connection();
        let backend = conn.get_database_backend();

        // ── 1. Insert the new permission rows (idempotent) ────────────
        for (name, desc) in NEW_PERMS {
            let exists = Query::select()
                .column(Permissions::Id)
                .from(Permissions::Table)
                .and_where(Expr::col(Permissions::Name).eq(*name))
                .limit(1)
                .to_owned();
            let exists = backend.build(&exists);
            if conn.query_one(exists).await?.is_some() {
                continue;
            }
            let insert = Query::insert()
                .into_table(Permissions::Table)
                .columns([
                    Permissions::Id,
                    Permissions::Name,
                    Permissions::Description,
                    Permissions::CreatedAt,
                ])
                .values_panic([
                    Expr::value(uuid::Uuid::new_v4()),
                    (*name).into(),
                    (*desc).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(insert).await?;
        }

        // ── 2. Insert the `admin` role (idempotent) ───────────────────
        let admin_role_id: uuid::Uuid = {
            let sel = Query::select()
                .column(Roles::Id)
                .from(Roles::Table)
                .and_where(Expr::col(Roles::Name).eq("admin"))
                .limit(1)
                .to_owned();
            let sel = backend.build(&sel);
            match conn.query_one(sel).await? {
                Some(row) => row.try_get("", "id")?,
                None => {
                    let id = uuid::Uuid::new_v4();
                    let insert = Query::insert()
                        .into_table(Roles::Table)
                        .columns([Roles::Id, Roles::Name, Roles::Description, Roles::CreatedAt])
                        .values_panic([
                            id.into(),
                            "admin".into(),
                            "Full access — system administrator".into(),
                            Expr::current_timestamp().into(),
                        ])
                        .to_owned();
                    manager.exec_stmt(insert).await?;
                    id
                }
            }
        };

        // ── 3. Grant EVERY permission to `admin` (idempotent) ─────────
        let all_perms = {
            let sel = Query::select()
                .columns([Permissions::Id, Permissions::Name])
                .from(Permissions::Table)
                .to_owned();
            let sel = backend.build(&sel);
            conn.query_all(sel)
                .await?
                .into_iter()
                .map(|row| {
                    let id: uuid::Uuid = row.try_get("", "id")?;
                    Ok((id, row.try_get::<String>("", "name")?))
                })
                .collect::<Result<Vec<_>, DbErr>>()?
        };
        for (perm_id, _) in &all_perms {
            let grant_exists = Query::select()
                .column(RolePermissions::RoleId)
                .from(RolePermissions::Table)
                .and_where(Expr::col(RolePermissions::RoleId).eq(admin_role_id))
                .and_where(Expr::col(RolePermissions::PermissionId).eq(*perm_id))
                .limit(1)
                .to_owned();
            let grant_exists = backend.build(&grant_exists);
            if conn.query_one(grant_exists).await?.is_some() {
                continue;
            }
            let grant = Query::insert()
                .into_table(RolePermissions::Table)
                .columns([
                    RolePermissions::RoleId,
                    RolePermissions::PermissionId,
                    RolePermissions::AssignedAt,
                ])
                .values_panic([
                    admin_role_id.into(),
                    (*perm_id).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(grant).await?;
        }

        // ── 4. Revoke admin-only permissions from `employee` ──────────
        let employee_role_id: Option<uuid::Uuid> = {
            let sel = Query::select()
                .column(Roles::Id)
                .from(Roles::Table)
                .and_where(Expr::col(Roles::Name).eq("employee"))
                .limit(1)
                .to_owned();
            let sel = backend.build(&sel);
            conn.query_one(sel)
                .await?
                .and_then(|r| r.try_get::<uuid::Uuid>("", "id").ok())
        };
        if let Some(employee_id) = employee_role_id {
            let admin_only_ids: Vec<uuid::Uuid> = all_perms
                .iter()
                .filter(|(_, name)| ADMIN_ONLY_PERMS.contains(&name.as_str()))
                .map(|(id, _)| *id)
                .collect();
            for perm_id in admin_only_ids {
                let revoke = Query::delete()
                    .from_table(RolePermissions::Table)
                    .and_where(Expr::col(RolePermissions::RoleId).eq(employee_id))
                    .and_where(Expr::col(RolePermissions::PermissionId).eq(perm_id))
                    .to_owned();
                manager.exec_stmt(revoke).await?;
            }
        }

        // ── 5. Promote the first human employee → admin ───────────────
        // On existing databases the bootstrap account has role="employee"
        // (the first signup used to get "employee"). The new rule is
        // "first user = admin", so promote that account. Fresh databases
        // have no users yet — this is a no-op there (register() assigns
        // "admin" directly).
        let first_employee: Option<uuid::Uuid> = {
            let sel = Query::select()
                .column(User::Id)
                .from(User::Table)
                .and_where(Expr::col(User::Role).eq("employee"))
                .and_where(Expr::col(User::IsBot).eq(false))
                .order_by(User::CreatedAt, sea_orm::sea_query::Order::Asc)
                .limit(1)
                .to_owned();
            let sel = backend.build(&sel);
            conn.query_one(sel)
                .await?
                .and_then(|r| r.try_get::<uuid::Uuid>("", "id").ok())
        };
        if let Some(user_id) = first_employee {
            let promote = Query::update()
                .table(User::Table)
                .value(User::Role, "admin")
                .and_where(Expr::col(User::Id).eq(user_id))
                .to_owned();
            manager.exec_stmt(promote).await?;

            // Re-point the user_roles grant: drop every role grant for this
            // user, then insert the admin grant.
            let clear = Query::delete()
                .from_table(UserRoles::Table)
                .and_where(Expr::col(UserRoles::UserId).eq(user_id))
                .to_owned();
            manager.exec_stmt(clear).await?;
            let grant = Query::insert()
                .into_table(UserRoles::Table)
                .columns([UserRoles::UserId, UserRoles::RoleId, UserRoles::AssignedAt])
                .values_panic([
                    user_id.into(),
                    admin_role_id.into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(grant).await?;
        }

        // ── 6. Normalise bot accounts down to the `user` role ─────────
        // The bot was historically created with the first user's role
        // ("employee"). It is not staff — presence/assignment logic must
        // never consider it.
        let demote_bots = Query::update()
            .table(User::Table)
            .value(User::Role, "user")
            .and_where(Expr::col(User::IsBot).eq(true))
            .and_where(Expr::col(User::Role).ne("user"))
            .to_owned();
        manager.exec_stmt(demote_bots).await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // No-op — reverting a role split would silently break access
        // control. Restoring from a backup is the correct path.
        Ok(())
    }
}
