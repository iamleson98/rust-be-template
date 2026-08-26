//! Drops the `distance_km` and `duration_min` columns from the `route` table.
//!
//! These columns were created by `m20260809_014716_routes_pickups_buslayout_seats`
//! but are no longer used — the platform now derives trip ETA from the
//! schedule's `departure_time` + Valhalla routing on the public map page,
//! and distance is no longer surfaced on the route entity.
//!
//! Both SQLite (3.35+) and Postgres support `ALTER TABLE ... DROP COLUMN`.
//! SQLite additionally restricts DROP COLUMN inside a transaction, so we
//! use `execute_unprepared` (which SeaORM runs outside an explicit
//! transaction for ALTER statements on SQLite).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // ALTER TABLE ... DROP COLUMN is supported on SQLite 3.35+ and
        // all modern Postgres versions. We use raw SQL because SeaORM's
        // `Table::alter().table(...).drop_column(...)` builder has
        // historically had quirks on SQLite (it sometimes emits a full
        // table-rebuild which drops indexes — see sea-query#224).
        //
        // Both columns are nullable, so dropping them can never violate a
        // NOT NULL constraint on existing rows.
        db.execute_unprepared(r#"ALTER TABLE "route" DROP COLUMN "distance_km""#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE "route" DROP COLUMN "duration_min""#)
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        // Re-add the columns as nullable to restore the previous shape.
        db.execute_unprepared(r#"ALTER TABLE "route" ADD COLUMN "distance_km" DOUBLE"#)
            .await?;
        db.execute_unprepared(r#"ALTER TABLE "route" ADD COLUMN "duration_min" SMALLINT"#)
            .await?;
        Ok(())
    }
}
