//! RBAC tables — roles, permissions and their join tables.
//!
//!   1. `roles`            — named roles (admin / employee / user, seeded
//!                           in the final seed migration)
//!   2. `permissions`      — permission catalogue (`users:read`,
//!                           `admin:bookings:write`, …)
//!   3. `user_roles`       — M2M user ↔ role
//!   4. `role_permissions` — M2M role ↔ permission
//!
//! Grants are seeded by `m20260905_000010_seed_defaults`, after every
//! permission-introducing table migration has run.

use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ── roles ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Roles::Table)
                    .col(pk_uuid(Roles::Id))
                    .col(string_len_uniq(Roles::Name, 64))
                    .col(string_null(Roles::Description))
                    .col(timestamp(Roles::CreatedAt).default(Expr::current_timestamp()))
                    .to_owned(),
            )
            .await?;

        // ── permissions ──────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Permissions::Table)
                    .col(pk_uuid(Permissions::Id))
                    .col(string_len_uniq(Permissions::Name, 128))
                    .col(string_null(Permissions::Description))
                    .col(
                        timestamp(Permissions::CreatedAt)
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // ── user_roles (M2M user ↔ role) ─────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(UserRoles::Table)
                    .col(uuid(UserRoles::UserId))
                    .col(uuid(UserRoles::RoleId))
                    .col(
                        timestamp(UserRoles::AssignedAt)
                            .default(Expr::current_timestamp()),
                    )
                    .primary_key(
                        Index::create()
                            .col(UserRoles::UserId)
                            .col(UserRoles::RoleId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_user_roles_user")
                            .from(UserRoles::Table, UserRoles::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_user_roles_role")
                            .from(UserRoles::Table, UserRoles::RoleId)
                            .to(Roles::Table, Roles::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ── role_permissions (M2M role ↔ permission) ─────────────────
        manager
            .create_table(
                Table::create()
                    .table(RolePermissions::Table)
                    .col(uuid(RolePermissions::RoleId))
                    .col(uuid(RolePermissions::PermissionId))
                    .col(
                        timestamp(RolePermissions::AssignedAt)
                            .default(Expr::current_timestamp()),
                    )
                    .primary_key(
                        Index::create()
                            .col(RolePermissions::RoleId)
                            .col(RolePermissions::PermissionId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_role_permissions_role")
                            .from(RolePermissions::Table, RolePermissions::RoleId)
                            .to(Roles::Table, Roles::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_role_permissions_permission")
                            .from(RolePermissions::Table, RolePermissions::PermissionId)
                            .to(Permissions::Table, Permissions::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Belt-and-braces uniqueness on (role_id, permission_id) so grant
        // code can never double-insert.
        manager
            .create_index(
                Index::create()
                    .name("role_permissions_role_perm_uniq")
                    .table(RolePermissions::Table)
                    .col(RolePermissions::RoleId)
                    .col(RolePermissions::PermissionId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse dependency order.
        for table in [
            RolePermissions::Table.into_iden(),
            UserRoles::Table.into_iden(),
            Permissions::Table.into_iden(),
            Roles::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().cascade().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ── Iden enums ──────────────────────────────────────────────────────────

/// Minimal reference to the `user` table (created in
/// `m20260905_000001_create_users_auth`) — keeps this migration
/// self-contained instead of importing another module's Iden enum.
#[derive(DeriveIden)]
enum User {
    Table,
    Id,
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
enum UserRoles {
    Table,
    UserId,
    RoleId,
    AssignedAt,
}

#[derive(DeriveIden)]
enum RolePermissions {
    Table,
    RoleId,
    PermissionId,
    AssignedAt,
}
