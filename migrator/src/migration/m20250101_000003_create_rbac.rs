use sea_orm_migration::{prelude::*, schema::*};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // roles
        manager
            .create_table(
                Table::create()
                    .table(Roles::Table)
                    .if_not_exists()
                    .col(pk_uuid(Roles::Id))
                    .col(string_len_uniq(Roles::Name, 64))
                    .col(string_null(Roles::Description))
                    .col(timestamp(Roles::CreatedAt).default(Expr::current_timestamp()))
                    .to_owned(),
            )
            .await?;

        // permissions
        manager
            .create_table(
                Table::create()
                    .table(Permissions::Table)
                    .if_not_exists()
                    .col(pk_uuid(Permissions::Id))
                    .col(string_len_uniq(Permissions::Name, 128))
                    .col(string_null(Permissions::Description))
                    .col(timestamp(Permissions::CreatedAt).default(Expr::current_timestamp()))
                    .to_owned(),
            )
            .await?;

        // user_roles (M2M user <-> role)
        manager
            .create_table(
                Table::create()
                    .table(UserRoles::Table)
                    .if_not_exists()
                    .col(uuid(UserRoles::UserId))
                    .col(uuid(UserRoles::RoleId))
                    .col(timestamp(UserRoles::AssignedAt).default(Expr::current_timestamp()))
                    .primary_key(
                        Index::create()
                            .col(UserRoles::UserId)
                            .col(UserRoles::RoleId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_user_roles_user")
                            .from(UserRoles::Table, UserRoles::UserId)
                            .to(
                                sea_orm::sea_query::Alias::new("user"),
                                sea_orm::sea_query::Alias::new("id"),
                            )
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_user_roles_role")
                            .from(UserRoles::Table, UserRoles::RoleId)
                            .to(Roles::Table, Roles::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // role_permissions (M2M role <-> permission)
        manager
            .create_table(
                Table::create()
                    .table(RolePermissions::Table)
                    .if_not_exists()
                    .col(uuid(RolePermissions::RoleId))
                    .col(uuid(RolePermissions::PermissionId))
                    .col(timestamp(RolePermissions::AssignedAt).default(Expr::current_timestamp()))
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
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_role_permissions_permission")
                            .from(RolePermissions::Table, RolePermissions::PermissionId)
                            .to(Permissions::Table, Permissions::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop in dependency-safe order. `if_exists()` so we don't error
        // if a previous run already dropped them.
        for t in ["role_permissions", "user_roles", "permissions", "roles"] {
            manager
                .drop_table(
                    Table::drop()
                        .if_exists()
                        .table(sea_orm::sea_query::Alias::new(t))
                        .to_owned(),
                )
                .await?;
        }
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
