//! Renames the `zero_claw_exchange` table to `null_claw_exchange`.
//!
//! This is part of the zeroclaw→nullclaw rename. Since the table
//! already exists (created by `m20260809_021759_nullclaw.rs` —
//! previously `m20260809_021759_zeroclaw.rs`), we use
//! `ALTER TABLE ... RENAME TO ...` which is supported by both
//! SQLite (3.25+) and Postgres.
//!
//! We also update the SeaORM entity (`null_claw_exchange.rs`) to
//! reference the new table name. The entity's `table_name`
//! attribute is the source of truth — once it says
//! `null_claw_exchange`, the old table is orphaned without this
//! migration.
//!
//! ## Why not just drop + recreate?
//!
//! Dropping the table would lose the AI reply audit log. RENAME
//! preserves all existing rows + indexes.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Rename the table. Both SQLite + Postgres support
        // `ALTER TABLE ... RENAME TO ...`.
        //
        // The SeaORM entity's `table_name` attribute was already
        // updated to `null_claw_exchange` (in `src/entity/null_claw_exchange.rs`).
        // This migration brings the database schema in sync.
        //
        // Uses `execute_unprepared` on the connection (not `manager`).
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"ALTER TABLE "zero_claw_exchange" RENAME TO "null_claw_exchange""#,
        ).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"ALTER TABLE "null_claw_exchange" RENAME TO "zero_claw_exchange""#,
        ).await?;
        Ok(())
    }
}
