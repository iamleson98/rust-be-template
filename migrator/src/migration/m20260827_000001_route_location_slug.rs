//! Alters `route.start_location_id` and `route.end_location_id` from
//! `UUID NULL` (FK to `place.id`) to `VARCHAR(20) NOT NULL` storing
//! Vietnamese city slugs (e.g. `"ha-noi"`, `"da-nang"`).
//!
//! ## Why
//!
//! The route form lets the admin pick from a fixed list of 61
//! Vietnamese cities (centrally-governed municipalities + provinces).
//! The frontend already sends the slug string as `startLocationId` /
//! `endLocationId`, but the DB column was `UUID NULL` — so creating
//! a route with `"ha-noi"` would fail at the UUID-parsing layer.
//!
//! The cities are now hardcoded in `src/cities.rs` (mirroring
//! `frontend/src/lib/vietnamese-cities.ts`). There's no `place` row
//! to FK to — the slug IS the identifier. The columns are NOT NULL
//! because a route without start/end cities is meaningless — the
//! route form requires both fields.
//!
//! ## What this migration does
//!
//! 1. Drop the `Route_startEnd_idx` composite index on
//!    `(start_location_id, end_location_id)` (Postgres won't let us
//!    alter a column that's indexed; SQLite is more permissive but
//!    dropping first keeps the two backends symmetric).
//! 2. Drop the `fk_route_start_loc` and `fk_route_end_loc` foreign
//!    keys to `place.id` (Postgres only — SQLite doesn't support
//!    `DROP CONSTRAINT`).
//! 3. Backfill any NULL rows with a placeholder slug `"unknown"` so
//!    the subsequent `SET NOT NULL` doesn't fail. In practice the
//!    table is empty in dev environments, and prod doesn't exist yet.
//! 4. Alter both columns from `UUID NULL` → `VARCHAR(20) NOT NULL`.
//! 5. Recreate `Route_startEnd_idx` on the new `(start_location_id,
//!    end_location_id)` pair — still useful for equality lookups on
//!    the slug pair (e.g. "find routes from ha-noi to da-nang").
//!
//! ## SQLite caveat
//!
//! SQLite doesn't support `ALTER COLUMN ... SET NOT NULL` directly —
//! SeaORM's `Table::alter().modify_column()` abstracts this via the
//! 12-step table-rebuild procedure (rename, create new, copy, drop
//! old, rename new). The new column type is `String(StringLen::N(20))`
//! and is NOT nullable.
//!
//! ## DOWN migration
//!
//! Reverses all 5 steps. NOTE: the column data isn't converted back
//! to UUIDs — slugs can't be parsed back to UUIDs, so any rows that
//! were inserted with slugs will have NULL in the UUID column (the
//! original schema's columns were nullable, so this is safe).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // ── Step 1: drop the composite index ─────────────────────────
        //
        // Both SQLite and Postgres accept `DROP INDEX IF EXISTS`.
        db.execute_unprepared(r#"DROP INDEX IF EXISTS "Route_startEnd_idx""#)
            .await?;

        // ── Step 2: drop the two foreign keys ─────────────────────────
        //
        // Postgres supports `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`.
        // SQLite doesn't support `DROP CONSTRAINT` at all — but since
        // we're about to ALTER the column TYPE from UUID to VARCHAR
        // (which SQLite implements as a table rebuild), the FK is
        // implicitly dropped as part of the rebuild. So on SQLite we
        // just skip the DROP CONSTRAINT.
        if manager.has_table("route").await? {
            let backend = manager.get_database_backend();
            if matches!(backend, sea_orm::DbBackend::Postgres) {
                db.execute_unprepared(
                    r#"ALTER TABLE "route" DROP CONSTRAINT IF EXISTS "fk_route_start_loc""#,
                )
                .await?;
                db.execute_unprepared(
                    r#"ALTER TABLE "route" DROP CONSTRAINT IF EXISTS "fk_route_end_loc""#,
                )
                .await?;
            }
        }

        // ── Step 3: backfill NULL rows with a placeholder ─────────────
        //
        // The original column was `UUID NULL` — existing rows might
        // have NULL. The next step (alter to VARCHAR NOT NULL) would
        // fail if any NULLs exist. We set them to "unknown" so the
        // NOT NULL constraint can be applied. In practice the table
        // is empty in dev, and prod doesn't exist yet — this is just
        // a safety net.
        //
        // We use `COALESCE` to convert both NULL and any existing UUID
        // string values (which can't be a valid slug) to "unknown".
        // The UUID-to-text cast works on both Postgres and SQLite.
        db.execute_unprepared(
            r#"UPDATE "route" SET "start_location_id" = 'unknown'
               WHERE "start_location_id" IS NULL
                  OR "start_location_id"::text NOT SIMILAR TO '[a-z](-[a-z])*'"#,
        )
        .await?;
        db.execute_unprepared(
            r#"UPDATE "route" SET "end_location_id" = 'unknown'
               WHERE "end_location_id" IS NULL
                  OR "end_location_id"::text NOT SIMILAR TO '[a-z](-[a-z])*'"#,
        )
        .await?;

        // ── Step 4: alter both columns to VARCHAR(20) NOT NULL ────────
        //
        // SeaORM's `Table::alter().table().modify_column()` handles
        // both Postgres (`ALTER COLUMN TYPE`) and SQLite (table
        // rebuild). The new column type is `String(StringLen::N(20))`,
        // NOT NULL.
        use sea_orm_migration::schema::string_len;
        manager
            .alter_table(
                sea_query::Table::alter()
                    .table(Route::Table)
                    .modify_column(string_len(Route::StartLocationId, 20))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                sea_query::Table::alter()
                    .table(Route::Table)
                    .modify_column(string_len(Route::EndLocationId, 20))
                    .to_owned(),
            )
            .await?;

        // ── Step 5: recreate the composite index ──────────────────────
        manager
            .create_index(
                sea_query::Index::create()
                    .if_not_exists()
                    .name("Route_startEnd_idx")
                    .table(Route::Table)
                    .col(Route::StartLocationId)
                    .col(Route::EndLocationId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Drop the recreated index
        db.execute_unprepared(r#"DROP INDEX IF EXISTS "Route_startEnd_idx""#)
            .await?;

        // Revert both columns back to UUID NULL. The slug values can't
        // be parsed back to UUIDs, so we NULL them out first to avoid
        // a conversion error.
        db.execute_unprepared(
            r#"UPDATE "route" SET "start_location_id" = NULL, "end_location_id" = NULL"#,
        )
        .await?;

        // Re-add the columns as UUID NULL
        use sea_orm_migration::schema::uuid_null;
        manager
            .alter_table(
                sea_query::Table::alter()
                    .table(Route::Table)
                    .modify_column(uuid_null(Route::StartLocationId))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                sea_query::Table::alter()
                    .table(Route::Table)
                    .modify_column(uuid_null(Route::EndLocationId))
                    .to_owned(),
            )
            .await?;

        // Recreate the FKs (only on Postgres — SQLite can't add FK to
        // an existing table without a full rebuild).
        let backend = manager.get_database_backend();
        if matches!(backend, sea_orm::DbBackend::Postgres) {
            db.execute_unprepared(
                r#"ALTER TABLE "route"
                   ADD CONSTRAINT "fk_route_start_loc"
                   FOREIGN KEY ("start_location_id") REFERENCES "place"("id")
                   ON DELETE RESTRICT ON UPDATE CASCADE"#,
            )
            .await?;
            db.execute_unprepared(
                r#"ALTER TABLE "route"
                   ADD CONSTRAINT "fk_route_end_loc"
                   FOREIGN KEY ("end_location_id") REFERENCES "place"("id")
                   ON DELETE RESTRICT ON UPDATE CASCADE"#,
            )
            .await?;
        }

        // Recreate the index
        manager
            .create_index(
                sea_query::Index::create()
                    .if_not_exists()
                    .name("Route_startEnd_idx")
                    .table(Route::Table)
                    .col(Route::StartLocationId)
                    .col(Route::EndLocationId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
pub enum Route {
    Table,
    StartLocationId,
    EndLocationId,
}
