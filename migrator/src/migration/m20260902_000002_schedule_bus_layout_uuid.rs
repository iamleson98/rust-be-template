//! `schedule.bus_layout_id` → proper `uuid` type (Postgres only).
//!
//! The column was created as TEXT by `m20260809_020540` while the
//! `bus_layout.id` it references is a UUID — the "String vs Uuid" type
//! drift. On SQLite this is harmless now: SQLite columns are typeless
//! per value, and the schedule entity binds `Option<Uuid>` (16-byte
//! BLOB), which matches the BLOB-stored layout ids — the FK finally
//! holds. On Postgres the column type is enforced, so we ALTER it to
//! `uuid`; existing TEXT values parse with `NULLIF(...)::uuid` (empty
//! strings → NULL).
//!
//! SQLite: no-op (declared type is cosmetic; see the entity field
//! comment on `schedule.bus_layout_id`).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_connection().get_database_backend();
        if backend == sea_orm::DatabaseBackend::Postgres {
            let conn = manager.get_connection();
            conn.execute_unprepared(
                r#"ALTER TABLE "schedule"
                   ALTER COLUMN "bus_layout_id" TYPE uuid
                   USING NULLIF("bus_layout_id", '')::uuid"#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_connection().get_database_backend();
        if backend == sea_orm::DatabaseBackend::Postgres {
            let conn = manager.get_connection();
            conn.execute_unprepared(
                r#"ALTER TABLE "schedule"
                   ALTER COLUMN "bus_layout_id" TYPE text
                   USING "bus_layout_id"::text"#,
            )
            .await?;
        }
        Ok(())
    }
}
