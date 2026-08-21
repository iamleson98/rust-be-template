//! Idempotently adds the new `admin:payments:*` permissions (introduced
//! alongside the payments feature) to existing databases that already ran
//! the original RBAC seed. New databases pick them up directly from
//! `m20250101_000005_seed_rbac`; this migration is a no-op there.
//!
//! Strategy: SELECT first to check if the perm exists, then INSERT only
//! if missing. The grant follows the same pattern — SELECT the role id +
//! perm id, then INSERT only if not already granted. All checks use
//! the high-level SeaORM `Query::select()` API (NOT raw SQL) so the
//! placeholder translation (`?` on SQLite, `$N` on Postgres) is handled
//! by sea-query automatically. The previous version used raw SQL with
//! `$1`/`$2` placeholders which is Postgres-only — it would fail on
//! SQLite.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

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
    ("admin:payments:read", "Admin: list/view payments"),
    (
        "admin:payments:write",
        "Admin: update payment status, mark COD collected",
    ),
];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::{Expr, Query};

        // ── 1. Unique index on role_permissions(role_id, permission_id) ──
        // Lets the grant step be safely re-runnable even on databases
        // without this constraint. We use `or_ignore()`-equivalent semantics
        // by checking existence first (below).
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("role_permissions_role_perm_uniq")
                    .table(RolePermissions::Table)
                    .col(RolePermissions::RoleId)
                    .col(RolePermissions::PermissionId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        let conn = manager.get_connection();
        let backend = conn.get_database_backend();

        // Look up the `employee` role id once. If the role doesn't exist
        // (shouldn't happen on a populated DB, but defensive), skip the grants.
        //
        // Uses the high-level `Query::select()` API so sea-query
        // translates placeholders correctly (`?` on SQLite, `$1` on
        // Postgres). The previous raw-SQL version used `$1` which is
        // Postgres-only.
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
            // 2. Check if the permission already exists.
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
                    // Insert it.
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

            // 3. Grant to employee (if the role was found).
            if let Some(role_id) = &employee_role_id {
                // Check if the grant already exists.
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

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // No-op — removing permissions would silently break the admin UI.
        Ok(())
    }
}
