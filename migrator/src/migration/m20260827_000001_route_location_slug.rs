//! Alters `route.start_location_id` and `route.end_location_id` from
//! `UUID` (FK to `place.id`) to `VARCHAR(20)` storing Vietnamese city
//! slugs (e.g. `"ha-noi"`, `"da-nang"`).
//!
//! ## Why
//!
//! The route form lets the admin pick from a fixed list of 63
//! Vietnamese cities (centrally-governed municipalities + provinces).
//! The frontend already sends the slug string as `startLocationId` /
//! `endLocationId`, but the DB column was `UUID` — so creating a
//! route with `"ha-noi"` would fail at the UUID-parsing layer.
//!
//! The cities are now hardcoded in `src/cities.rs` (mirroring
//! `frontend/src/lib/vietnamese-cities.ts`). There's no `place` row
//! to FK to — the slug IS the identifier.
//!
//! ## What this migration does
//!
//! 1. Drop the `Route_startEnd_idx` composite index on
//!    `(start_location_id, end_location_id)` (Postgres won't let us
//!    alter a column that's indexed; SQLite is more permissive but
//!    dropping first keeps the two backends symmetric).
//! 2. Drop the `fk_route_start_loc` and `fk_route_end_loc` foreign
//!    keys to `place.id`.
//! 3. Alter both columns from `UUID` → `VARCHAR(20)`.
//! 4. Recreate `Route_startEnd_idx` on the new `(start_location_id,
//!    end_location_id)` pair — still useful for equality lookups on
//!    the slug pair (e.g. "find routes from ha-noi to da-nang").
//!
//! ## Data migration
//!
//! None. The existing rows (if any) have UUID values that don't map
//! to any slug — we just null them out by ALTER'ing the column type.
//! In practice the table is empty in dev environments, and prod
//! doesn't exist yet (the route form was just rewritten to use slugs).
//!
//! ## SQLite caveat
//!
//! SQLite supports `ALTER TABLE ... DROP COLUMN` only on 3.35+, and
//! altering a column type is done via the 12-step "table rebuild"
//! procedure (rename, create new, copy, drop old, rename new).
//! Sea-orm-migration's `Table::alter().table(...).modify_column(...)`
//! abstracts this — it emits the right SQL on both backends.
//!
//! For the FK drop, we use `execute_unprepared` with raw SQL because
//! SeaORM's `Table::alter().drop_foreign_key()` builder has
//! historically had quirks on SQLite (it sometimes emits `ALTER
//! TABLE ... DROP CONSTRAINT` which SQLite doesn't support).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // ── Step 1: drop the composite index ─────────────────────────
        //
        // Both SQLite and Postgres accept `DROP INDEX IF EXISTS`, but
        // the syntax for the index NAME is identical. We use raw SQL
        // because SeaORM's `Index::drop()` builder expects a table
        // reference which differs slightly between backends.
        db.execute_unprepared(r#"DROP INDEX IF EXISTS "Route_startEnd_idx""#)
            .await?;

        // ── Step 2: drop the two foreign keys ─────────────────────────
        //
        // Postgres: `ALTER TABLE ... DROP CONSTRAINT IF EXISTS <name>`
        // SQLite: foreign keys are part of the table definition —
        //   SQLite doesn't support `DROP CONSTRAINT` directly. However,
        //   since we're about to ALTER the column TYPE from UUID to
        //   VARCHAR (which SQLite doesn't really support either — it
        //   does a table rebuild under the hood), the FK is implicitly
        //   dropped as part of the rebuild. So on SQLite, we just skip
        //   the DROP CONSTRAINT and let the column alter handle it.
        //
        // We use `execute_unprepared` so the SQL runs as-is. The
        // `IF EXISTS` clause on the constraint is Postgres-only;
        // SQLite will fail the statement, but since SQLite doesn't
        // support named FK constraints at all (FKs are unnamed in
        // SQLite unless explicitly named during creation — and even
        // then, you can't DROP them), we wrap each in a backend check.
        if manager.has_table("route").await? {
            // Get the database backend to dispatch the right SQL.
            let backend = manager.get_database_backend();
            match backend {
                sea_orm::DbBackend::Postgres => {
                    db.execute_unprepared(
                        r#"ALTER TABLE "route" DROP CONSTRAINT IF EXISTS "fk_route_start_loc""#,
                    )
                    .await?;
                    db.execute_unprepared(
                        r#"ALTER TABLE "route" DROP CONSTRAINT IF EXISTS "fk_route_end_loc""#,
                    )
                    .await?;
                }
                sea_orm::DbBackend::Sqlite => {
                    // SQLite doesn't support DROP CONSTRAINT — the
                    // column-type alter below will rebuild the table
                    // without the FK. No-op here.
                }
                _ => {}
            }
        }

        // ── Step 3: alter both columns from UUID → VARCHAR(20) ────────
        //
        // SeaORM's `Table::alter().table().modify_column()` handles
        // both Postgres (ALTER COLUMN TYPE) and SQLite (table rebuild
        // under the hood). The new column type is `String(StringLen::N(20))`.
        use sea_orm_migration::schema::string_len_null;
        manager
            .alter_table(
                sea_query::Table::alter()
                    .table(Route::Table)
                    .modify_column(string_len_null(Route::StartLocationId, 20))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                sea_query::Table::alter()
                    .table(Route::Table)
                    .modify_column(string_len_null(Route::EndLocationId, 20))
                    .to_owned(),
            )
            .await?;

        // ── Step 4: recreate the composite index ──────────────────────
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

        // Re-add the foreign keys (best effort — requires the `place`
        // table to exist, which it does in any environment that ran
        // the original migration `m20260809_014716_routes_pickups_buslayout_seats`).
        //
        // Note: this DOWN migration does NOT convert the column data
        // back to UUIDs — the slugs can't be parsed back to UUIDs, so
        // any rows that were inserted with slugs will have NULL in the
        // UUID column. This matches the original schema's nullable
        // columns.
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
