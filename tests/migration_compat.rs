//! Migration compatibility tests — verifies that the full migration
//! suite runs cleanly on BOTH SQLite and Postgres.
//!
//! ## SQLite test
//!
//! Always runs. Uses an in-memory SQLite database
//! (`sqlite::memory:`) — no external deps, no cleanup needed.
//!
//! ## Postgres test
//!
//! Only runs when the `TEST_POSTGRES_URL` environment variable is set
//! to a live Postgres connection string (e.g.
//! `postgres://postgres:postgres@localhost:5432/test_db`). When the
//! variable is absent, the test is SKIPPED (not failed) — this keeps
//! CI fast on machines without Postgres installed.
//!
//! To run the Postgres test locally:
//!
//! ```sh
//! # 1. Start a Postgres instance (Docker is easiest):
//! docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres \
//!   -e POSTGRES_DB=test_db --name pg-test postgres:17
//!
//! # 2. Run the test with the postgres feature + URL:
//! TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/test_db \
//!   cargo test --test migration_compat --no-default-features --features postgres -- --include-ignored
//! ```
//!
//! ## What this catches
//!
//! - Migrations that use SQLite-only placeholder syntax (`$1` — should
//!   use the high-level `Query::select()` API which translates placeholders).
//! - Migrations that use SQLite-only column types or defaults.
//! - Migrations that fail on Postgres due to stricter type checking
//!   (e.g. comparing a TEXT column to a TIMESTAMP value).
//! - Migrations that fail on Postgres due to stricter FK enforcement
//!   (e.g. creating a FK before the referenced table exists).
//! - Seed data that doesn't insert correctly on Postgres (e.g. UUID
//!   generation, timestamp defaults).

use sea_orm::Database;
use sea_orm_migration::MigratorTrait;

/// Helper: run the full migration suite on the given DB URL.
/// Returns the connection so the caller can run additional assertions.
async fn run_migrations_on(db_url: &str) -> anyhow::Result<()> {
    let mut opts = sea_orm::ConnectOptions::new(db_url.to_string());
    opts.max_connections(1)
        .connect_timeout(std::time::Duration::from_secs(10));
    let db = Database::connect(opts).await?;

    // Apply all migrations — this is the actual test.
    migrator::Migrator::up(&db, None).await?;

    // Verify all tables exist by querying the schema.
    // On SQLite: `SELECT name FROM sqlite_master WHERE type='table'`.
    // On Postgres: `SELECT table_name FROM information_schema.tables
    //   WHERE table_schema='public'`.
    //
    // We use the backend-agnostic approach: just count the tables
    // via the `SchemaManager`-compatible `ConnectionTrait`.
    use sea_orm::ConnectionTrait;
    let backend = db.get_database_backend();
    let count_sql = match backend {
        sea_orm::DbBackend::Sqlite => {
            "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        }
        sea_orm::DbBackend::Postgres => {
            "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema='public'"
        }
        _ => return Err(anyhow::anyhow!("unsupported backend")),
    };
    let result = db.execute_unprepared(count_sql).await?;
    let row_count: i64 = {
        let row = db
            .query_one(sea_orm::Statement::from_sql_and_values(
                backend,
                count_sql,
                [],
            ))
            .await?
            .expect("COUNT(*) should return a row");
        row.try_get("", "c").unwrap_or(0)
    };
    let _ = result;

    // We expect at least 15 tables (users, posts, rbac, refresh_tokens,
    // places, brands, routes, schedules, bookings, chat, payments, etc.).
    assert!(
        row_count >= 15,
        "expected at least 15 tables after migration, got {}",
        row_count
    );

    // Clean up: drop all tables so the test can be re-run.
    // On Postgres, this also drops the `seql_migrations` table that
    // sea-orm-migration uses to track which migrations have run.
    migrator::Migrator::down(&db, None).await?;

    Ok(())
}

/// SQLite migration test — always runs (no external deps).
#[tokio::test]
async fn migrations_run_on_sqlite_in_memory() -> anyhow::Result<()> {
    run_migrations_on("sqlite::memory:").await
}

/// Postgres migration test — only runs when `TEST_POSTGRES_URL` is set.
///
/// This test is marked `#[ignore]` so it doesn't run by default. To
/// run it, pass `--include-ignored` to `cargo test` AND set the
/// `TEST_POSTGRES_URL` environment variable.
#[tokio::test]
#[ignore]
async fn migrations_run_on_postgres() -> anyhow::Result<()> {
    let pg_url = std::env::var("TEST_POSTGRES_URL").map_err(|_| {
        anyhow::anyhow!(
            "TEST_POSTGRES_URL not set — skipping Postgres migration test. \
             Set it to a live Postgres connection string to run this test."
        )
    })?;
    run_migrations_on(&pg_url).await
}
