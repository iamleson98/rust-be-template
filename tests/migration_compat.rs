//! Migration compatibility tests — verifies that the full migration
//! suite runs cleanly on the vendored SQLite engine.
//!
//! ## Engine
//!
//! The test uses an in-memory `sqlite::memory:` URL — sea-orm's sqlite
//! dialect on the SQLite built from `vendor/libsqlite3-sys` (see the
//! `[patch.crates-io]` block in the workspace Cargo.toml). No external
//! deps, no cleanup needed.
//!
//! ## What this catches
//!
//! - Migrations using placeholder syntax the engine's sqlite dialect
//!   can't bind (should use the high-level `Query::select()` API which
//!   translates placeholders).
//! - Migrations using column types, defaults or double-quoted string
//!   literals the engine doesn't accept (it is built with `SQLITE_DQS=0`).
//! - Seed data that doesn't insert correctly (e.g. UUID generation,
//!   timestamp defaults).
//! - Engine-level incompatibilities with sea-orm-migration's statement
//!   shapes.

use sea_orm::Database;
use sea_orm_migration::MigratorTrait;

/// Helper: run the full migration suite on the given DB URL.
async fn run_migrations_on(db_url: &str) -> anyhow::Result<()> {
    let mut opts = sea_orm::ConnectOptions::new(db_url.to_string());
    opts.max_connections(1)
        .connect_timeout(std::time::Duration::from_secs(10));
    let db = Database::connect(opts).await?;

    // Apply all migrations — this is the actual test.
    migrator::Migrator::up(&db, None).await?;

    // Verify all tables exist by querying the schema
    // (`SELECT name FROM sqlite_master WHERE type='table'`).
    use sea_orm::ConnectionTrait;
    let backend = db.get_database_backend();
    let count_sql =
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
    let row = db
        .query_one(sea_orm::Statement::from_sql_and_values(
            backend,
            count_sql,
            [],
        ))
        .await?
        .expect("COUNT(*) should return a row");
    let row_count: i64 = row.try_get("", "c").unwrap_or(0);

    // We expect at least 15 tables (users, posts, rbac, refresh_tokens,
    // places, brands, routes, schedules, bookings, chat, payments, etc.).
    assert!(
        row_count >= 15,
        "expected at least 15 tables after migration, got {}",
        row_count
    );

    // Clean up: drop all tables so the test can be re-run.
    migrator::Migrator::down(&db, None).await?;

    Ok(())
}

/// Migration test — always runs (no external deps).
#[tokio::test]
async fn migrations_run_in_memory() -> anyhow::Result<()> {
    run_migrations_on("sqlite::memory:").await
}
