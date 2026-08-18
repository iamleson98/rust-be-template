use sea_orm_migration::prelude::*;
use uuid::Uuid;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Seed the RBAC tables with two roles (employee, user) and the full
/// permission set used by the route handlers.
///
/// Permissions are grouped:
///   - users:    read, write, delete
///   - posts:    read, write, delete
///   - admin:brands:        read, write
///   - admin:routes:        read, write
///   - admin:schedules:     read, write
///   - admin:pickup_points: read, write
///   - admin:bus_layouts:    read
///   - admin:reviews:       moderate
///   - admin:bookings:      read, write
///   - admin:stats:         read
///   - admin:export
///
/// Role assignments:
///   - employee (admin): ALL permissions
///   - user:              posts:read, posts:write, users:read
///
/// Uses SeaORM's high-level API (not raw SQL) so the same migration runs
/// on both SQLite and Postgres without dialect-specific syntax.
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        use sea_orm::sea_query::Expr;

        let admin_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();

        // ---- Full permission set -----------------------------------------
        let perms: &[(&str, &str)] = &[
            // Users
            ("users:read", "Read user list and profiles"),
            ("users:write", "Create/update users"),
            ("users:delete", "Delete users"),
            // Posts
            ("posts:read", "Read posts"),
            ("posts:write", "Create/update posts"),
            ("posts:delete", "Delete posts"),
            // Admin — Brands
            ("admin:brands:read", "Admin: list/view brands"),
            ("admin:brands:write", "Admin: create/update/delete brands"),
            // Admin — Routes
            ("admin:routes:read", "Admin: list/view routes"),
            ("admin:routes:write", "Admin: create/update/delete routes"),
            // Admin — Schedules
            ("admin:schedules:read", "Admin: list/view schedules"),
            ("admin:schedules:write", "Admin: create/update/delete schedules"),
            // Admin — Pickup points
            ("admin:pickup_points:read", "Admin: list/view pickup points"),
            ("admin:pickup_points:write", "Admin: create/update/delete pickup points"),
            // Admin — Bus layouts
            ("admin:bus_layouts:read", "Admin: list bus layouts"),
            // Admin — Reviews
            ("admin:reviews:moderate", "Admin: moderate reviews (approve/reject/delete)"),
            // Admin — Bookings
            ("admin:bookings:read", "Admin: list/view bookings"),
            ("admin:bookings:write", "Admin: update booking status"),
            // Admin — Payments
            ("admin:payments:read", "Admin: list/view payments"),
            ("admin:payments:write", "Admin: update payment status, mark COD collected"),
            // Admin — Stats + Export
            ("admin:stats:read", "Admin: view booking statistics"),
            ("admin:export", "Admin: export bookings as CSV"),
        ];

        // ---- Insert roles ------------------------------------------------
        let stmt = sea_orm::sea_query::Query::insert()
            .into_table(Roles::Table)
            .columns([Roles::Id, Roles::Name, Roles::Description, Roles::CreatedAt])
            .values_panic([
                admin_id.into(),
                "employee".into(),
                "Full access — admin/support agent".into(),
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
                "Standard customer".into(),
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

        // ---- Employee (admin) gets every permission ---------------------
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
            let allowed = matches!(
                *name,
                "posts:read" | "posts:write" | "users:read"
            );
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
