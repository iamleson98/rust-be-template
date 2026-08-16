use sea_orm_migration::prelude::*;
use uuid::Uuid;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Seed the RBAC tables with two roles (admin, user) and a baseline
/// permission set used by the route handlers.
///
/// Uses SeaORM's high-level API (not raw SQL) so the same migration runs
/// on both SQLite and Postgres without dialect-specific syntax.
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::Expr;

        let admin_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let perms: &[(&str, &str)] = &[
            ("users:read", "Read users"),
            ("users:write", "Create/update users"),
            ("users:delete", "Delete users"),
            ("posts:read", "Read posts"),
            ("posts:write", "Create/update posts"),
            ("posts:delete", "Delete posts"),
        ];

        // ---- Insert roles ------------------------------------------------
        let stmt = sea_orm::sea_query::Query::insert()
            .into_table(Roles::Table)
            .columns([Roles::Id, Roles::Name, Roles::Description, Roles::CreatedAt])
            .values_panic([
                admin_id.into(),
                "employee".into(),
                "Full access".into(),
                Expr::current_timestamp().into(),
            ])
            .to_owned();
        manager.exec_stmt(stmt).await?;

        let stmt = sea_orm::sea_query::Query::insert()
            .into_table(Roles::Table)
            .columns([Roles::Id, Roles::Name, Roles::Description, Roles::CreatedAt])
            .values_panic([
                user_id.into(),
                "user".into(),
                "Standard user".into(),
                Expr::current_timestamp().into(),
            ])
            .to_owned();
        manager.exec_stmt(stmt).await?;

        // ---- Insert permissions -----------------------------------------
        let mut perm_ids: Vec<(Uuid, &str)> = Vec::new();
        for (name, desc) in perms {
            let id = Uuid::new_v4();
            perm_ids.push((id, name));
            let stmt = sea_orm::sea_query::Query::insert()
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

        // ---- Admin gets every permission --------------------------------
        for (pid, _) in &perm_ids {
            let stmt = sea_orm::sea_query::Query::insert()
                .into_table(RolePermissions::Table)
                .columns([
                    RolePermissions::RoleId,
                    RolePermissions::PermissionId,
                    RolePermissions::AssignedAt,
                ])
                .values_panic([
                    admin_id.into(),
                    (*pid).into(),
                    Expr::current_timestamp().into(),
                ])
                .to_owned();
            manager.exec_stmt(stmt).await?;
        }

        // ---- User gets read + write on posts, read on users --------------
        for (pid, name) in &perm_ids {
            let allowed = matches!(*name, "posts:read" | "posts:write" | "users:read");
            if allowed {
                let stmt = sea_orm::sea_query::Query::insert()
                    .into_table(RolePermissions::Table)
                    .columns([
                        RolePermissions::RoleId,
                        RolePermissions::PermissionId,
                        RolePermissions::AssignedAt,
                    ])
                    .values_panic([
                        user_id.into(),
                        (*pid).into(),
                        Expr::current_timestamp().into(),
                    ])
                    .to_owned();
                manager.exec_stmt(stmt).await?;
            }
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // No-op: the parent `create_rbac` migration drops all four
        // tables when it reverts. Trying to DELETE here would race with
        // that drop. Just return Ok.
        Ok(())
    }
}

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
