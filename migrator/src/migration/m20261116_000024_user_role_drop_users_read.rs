//! Customers lose `users:read`.
//!
//! The original seed granted it to the `user` role, so `GET /api/users`
//! listed every account's name, email and role to any signed-in
//! customer. Staff keep it. Deleting an absent grant is a no-op, so
//! databases that never had it (imported from D1) pass through unchanged.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "DELETE FROM role_permissions \
                 WHERE role_id IN (SELECT id FROM roles WHERE name = 'user') \
                   AND permission_id IN (SELECT id FROM permissions WHERE name = 'users:read')",
            )
            .await?;
        Ok(())
    }

    /// The grant was a bug; there is nothing to restore.
    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
