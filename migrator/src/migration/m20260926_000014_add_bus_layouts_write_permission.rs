//! Grant the `admin:bus_layouts:write` permission.
//!
//! The original RBAC seed (`m20260905_000010_seed_defaults`) only created
//! `admin:bus_layouts:read` because the backend exposed a single list
//! endpoint. The bus-layout catalog is now fully manageable (create with
//! seat-grid generation / update / guarded delete), which needs a write
//! permission checked at the route layer — same split as every other
//! admin resource.
//!
//! The seed migration now also lists the permission, so this migration
//! mostly matters for databases created before that (it is fully
//! idempotent: existing permission rows and grants are detected and
//! skipped).
//!
//! Grants:
//!   * `admin`     — always (the seed grants the role every permission).
//!   * `employee`  — operational staff manage seat layouts day-to-day
//!     (same class as brands/routes/schedules writes).

use sea_orm::{FromQueryResult, Statement};
use sea_orm_migration::prelude::*;
use uuid::Uuid;

#[derive(DeriveMigrationName)]
pub struct Migration;

const PERM_NAME: &str = "admin:bus_layouts:write";
const PERM_DESC: &str = "Admin: create/update/delete bus layouts";
const GRANTED_ROLES: &[&str] = &["admin", "employee"];

/// Result row for the id lookups below.
#[derive(sea_orm::FromQueryResult)]
struct IdRow {
    id: Uuid,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::Expr;

        let db = manager.get_connection();

        // ── 1. Ensure the permission row exists ────────────────────
        let find_perm = Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"SELECT id FROM permissions WHERE name = ?"#,
            [PERM_NAME.into()],
        );
        let perm_id = match IdRow::find_by_statement(find_perm).one(db).await? {
            Some(row) => row.id,
            None => {
                let stmt = Query::insert()
                    .into_table(Permissions::Table)
                    .columns([
                        Permissions::Id,
                        Permissions::Name,
                        Permissions::Description,
                        Permissions::CreatedAt,
                    ])
                    .values_panic([
                        Uuid::new_v4().into(),
                        PERM_NAME.into(),
                        PERM_DESC.into(),
                        Expr::current_timestamp().into(),
                    ])
                    .to_owned();
                manager.exec_stmt(stmt).await?;
                // Read back the generated id (`exec_stmt` doesn't return
                // the values_panic ids).
                let find_perm = Statement::from_sql_and_values(
                    db.get_database_backend(),
                    r#"SELECT id FROM permissions WHERE name = ?"#,
                    [PERM_NAME.into()],
                );
                IdRow::find_by_statement(find_perm)
                    .one(db)
                    .await?
                    .ok_or_else(|| {
                        DbErr::Custom("bus-layouts-write: inserted permission not found".into())
                    })?
                    .id
            }
        };

        // ── 2. Ensure the grants exist ─────────────────────────────
        for role in GRANTED_ROLES {
            let find_role = Statement::from_sql_and_values(
                db.get_database_backend(),
                r#"SELECT id FROM roles WHERE name = ?"#,
                [(*role).into()],
            );
            let role_id = IdRow::find_by_statement(find_role)
                .one(db)
                .await?
                .ok_or_else(|| {
                    DbErr::Custom(format!(
                        "bus-layouts-write: role {role} missing — run the seed migration first"
                    ))
                })?
                .id;

            let has_grant = Statement::from_sql_and_values(
                db.get_database_backend(),
                r#"SELECT role_id AS id FROM role_permissions WHERE role_id = ? AND permission_id = ?"#,
                [role_id.into(), perm_id.into()],
            );
            if IdRow::find_by_statement(has_grant).one(db).await?.is_some() {
                continue; // grant already present (fresh seed install)
            }

            let stmt = Query::insert()
                .into_table(RolePermissions::Table)
                .columns([
                    RolePermissions::RoleId,
                    RolePermissions::PermissionId,
                    RolePermissions::AssignedAt,
                ])
                .values_panic([
                    role_id.into(),
                    perm_id.into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::Expr;

        // Deleting the permission cascades to role_permissions via the
        // FK on_delete rules (same as the seed's `down`).
        let stmt = Query::delete()
            .from_table(Permissions::Table)
            .and_where(Expr::col(Permissions::Name).eq(PERM_NAME))
            .to_owned();
        manager.exec_stmt(stmt).await?;
        Ok(())
    }
}

// ── Minimal Iden enums (tables owned by earlier migrations) ─────────

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
