//! Idempotently adds the new `admin:payments:*` permissions (introduced
//! alongside the payments feature) to existing databases that already ran
//! the original RBAC seed. New databases pick them up directly from
//! `m20250101_000005_seed_rbac`; this migration is a no-op there.
//!
//! Strategy: SELECT first to check if the perm exists, then INSERT only
//! if missing. The grant follows the same pattern — SELECT the role id +
//! perm id, then INSERT only if not already granted. All checks use
//! the `ConnectionTrait` exposed by `manager.get_connection()`, so
//! they work uniformly on SQLite + Postgres.

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
        use sea_orm::sea_query::Expr;

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

        // Look up the `employee` role id once. If the role doesn't exist
        // (shouldn't happen on a populated DB, but defensive), skip the grants.
        let employee_role_id: Option<String> = {
            let stmt = sea_orm::Statement::from_sql_and_values(
                conn.get_database_backend(),
                r#"SELECT "id" FROM "roles" WHERE "name" = 'employee' LIMIT 1"#,
                [],
            );
            let row = conn.query_one(stmt).await?;
            row.and_then(|r| r.try_get::<String>("", "id").ok())
        };

        for (name, desc) in NEW_PERMS {
            // 2. Check if the permission already exists.
            let exists_stmt = sea_orm::Statement::from_sql_and_values(
                conn.get_database_backend(),
                r#"SELECT "id" FROM "permissions" WHERE "name" = $1 LIMIT 1"#,
                [(*name).into()],
            );
            let existing = conn.query_one(exists_stmt).await?;
            let perm_id_str: String = match existing {
                Some(row) => row.try_get("", "id")?,
                None => {
                    // Insert it.
                    let new_id = uuid::Uuid::new_v4().to_string();
                    let insert_perm = sea_orm::sea_query::Query::insert()
                        .into_table(Permissions::Table)
                        .columns([
                            Permissions::Id,
                            Permissions::Name,
                            Permissions::Description,
                            Permissions::CreatedAt,
                        ])
                        .values_panic([
                            new_id.clone().into(),
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
            if let Some(role_id_str) = &employee_role_id {
                // Check if the grant already exists.
                let grant_exists_stmt = sea_orm::Statement::from_sql_and_values(
                    conn.get_database_backend(),
                    r#"SELECT 1 FROM "role_permissions" WHERE "role_id" = $1 AND "permission_id" = $2 LIMIT 1"#,
                    [role_id_str.clone().into(), perm_id_str.clone().into()],
                );
                let already_granted = conn.query_one(grant_exists_stmt).await?.is_some();
                if !already_granted {
                    let grant = sea_orm::sea_query::Query::insert()
                        .into_table(RolePermissions::Table)
                        .columns([
                            RolePermissions::RoleId,
                            RolePermissions::PermissionId,
                            RolePermissions::AssignedAt,
                        ])
                        .values_panic([
                            role_id_str.clone().into(),
                            perm_id_str.clone().into(),
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
