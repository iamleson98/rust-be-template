//! 12-factor Rust backend: layered store + RBAC + JWT + WebSocket + worker.
//!
//! Module map:
//! - `config`: typed `.env`-driven config
//! - `error`: unified `AppError` → HTTP response mapping
//! - `entity`: SeaORM entities (mirror of `sea-orm-cli generate entity`)
//! - `migration`: SeaORM migrations (moved to the `migrator` crate)
//! - `cache`: pluggable cache (`MokaBackend` | `RedisBackend`)
//! - `store`: per-entity DB+retry+cache stores composed into one `Store`
//! - `storage`: pluggable file storage (`Local` | `S3` | `MinIO`)
//! - `worker`: pluggable async job broker (`Redis` | `Db` | `Kafka`)
//! - `ws`: in-process WebSocket chat hub (extensible to Redis fan-out)
//! - `audio_call`: WebRTC signaling relay (`/ws-call`)
//! - `osm`: Tantivy place-search index (Vietnamese-aware, OSM PBF ingestion)
//! - `nullclaw`: pluggable AI customer-support assistant
//! - `rbac`: cached role + permission checker
//! - `auth`: password, JWT, refresh, cookies, SessionUser
//! - `middleware`: rate limit, auth extractors, request id
//! - `routes`: axum handlers + utoipa OpenAPI
//! - `state`: AppState
//! - `server`: bootstrap + run

pub mod audio_call;
pub mod auth;
pub mod cache;
pub mod cities;
pub mod cli;
pub mod config;
pub mod db;
pub mod dto;
pub mod entity;
pub mod error;
pub mod guard;
pub mod jobs;
pub mod memory;
pub mod middleware;
pub mod nullclaw;
pub mod osm;
pub mod payment;
pub mod presence;
pub mod push;
pub mod rbac;
pub mod routes;
pub mod scheduler;
pub mod server;
pub mod service;
pub mod state;
pub mod storage;
pub mod store;
pub mod validation;
pub mod worker;
pub mod ws;

// Re-export the Migrator from the standalone migrator crate.
pub use migrator::Migrator;

use sea_orm::ConnectionTrait;
use sea_orm::DatabaseConnection;

/// Apply all pending SeaORM migrations. Idempotent — safe to call on
/// every startup.
///
/// First heals a schema quirk left behind by older rust-sql engine
/// builds on long-lived databases: `seaql_migrations.applied_at` created
/// as TEXT (sea-orm-migration declares it BIGINT). The migrator's own
/// `SELECT` decodes that column as `Option<i64>`, so a TEXT-typed
/// column aborts boot with a type-mismatch decode error — the v0.5.1
/// deploy's new task crashed exactly there and Swarm rolled the service
/// back. [`repair_seaql_migrations_applied_at`] rebuilds the table with
/// the declared INTEGER column and CASTs the old values, once, in
/// place; fresh databases (correct schema already) are untouched.
pub async fn run_migrations(db: &DatabaseConnection) -> anyhow::Result<()> {
    use sea_orm_migration::MigratorTrait;
    repair_seaql_migrations_applied_at(db).await?;
    Migrator::up(db, None).await?;
    Ok(())
}

/// Rebuild `seaql_migrations` when `applied_at` is declared TEXT.
///
/// The rebuild preserves the `version` strings verbatim (they are the
/// migration identity and ordering key) and CASTs `applied_at` to
/// INTEGER — the column is informational (a timestamp), never a join or
/// filter key, so a lossy cast of legacy values is harmless while the
/// column TYPE must match what sea-orm-migration decodes.
///
/// Idempotent: the pragma probe is a no-op when the schema is already
/// correct (fresh databases, engines that always created it INTEGER).
async fn repair_seaql_migrations_applied_at(db: &DatabaseConnection) -> anyhow::Result<()> {
    // Does the tracking table exist at all? (Fresh DB: it does not yet —
    // sea-orm-migration creates it moments later with the right schema.)
    let table_exists = db
        .query_one(sea_orm::Statement::from_string(
            db.get_database_backend(),
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='seaql_migrations'"
                .to_string(),
        ))
        .await?
        .is_some();
    if !table_exists {
        return Ok(());
    }
    // pragma_table_info's `type` column holds the DECLARED type.
    let rows = db
        .query_all(sea_orm::Statement::from_string(
            db.get_database_backend(),
            "SELECT name, type FROM pragma_table_info('seaql_migrations')".to_string(),
        ))
        .await?;
    let applied_at_text = rows.iter().any(|row| {
        let name: String = row.try_get("", "name").unwrap_or_default();
        let ty: String = row.try_get("", "type").unwrap_or_default();
        name == "applied_at" && ty.eq_ignore_ascii_case("text")
    });
    if !applied_at_text {
        return Ok(()); // schema already correct
    }
    tracing::warn!(
        "seaql_migrations.applied_at is declared TEXT (legacy engine build) — \
         rebuilding the table with INTEGER before the migrator reads it"
    );
    for stmt in [
        // Stage the rows first (version strings preserved verbatim —
        // they are the migration identity), then drop + recreate under
        // the same name with the declared INTEGER column and CAST the
        // values back in. No ALTER TABLE RENAME: the engine's rename
        // path has history around PK autoindexes (8892133), and the
        // staged swap exercises only CREATE / INSERT-SELECT / DROP.
        "CREATE TABLE seaql_migrations_stage ( \
            version TEXT PRIMARY KEY NOT NULL, \
            applied_at INTEGER)",
        "INSERT INTO seaql_migrations_stage (version, applied_at) \
         SELECT version, CAST(applied_at AS INTEGER) FROM seaql_migrations",
        "DROP TABLE seaql_migrations",
        "CREATE TABLE seaql_migrations ( \
            version TEXT PRIMARY KEY NOT NULL, \
            applied_at INTEGER)",
        "INSERT INTO seaql_migrations (version, applied_at) \
         SELECT version, applied_at FROM seaql_migrations_stage",
        "DROP TABLE seaql_migrations_stage",
    ] {
        db.execute(sea_orm::Statement::from_string(
            db.get_database_backend(),
            stmt.to_string(),
        ))
        .await?;
    }
    tracing::info!("seaql_migrations schema repaired (applied_at INTEGER)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The v0.5.1 deploy crash: sea-orm-migration decodes applied_at as
    /// `Option<i64>`, but legacy engine builds left the column declared
    /// TEXT. The repair rebuilds the table (INTEGER + CAST) so the
    /// migrator's query decodes; calling it twice is a no-op.
    #[tokio::test]
    async fn repairs_legacy_text_applied_at_column() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        // The legacy shape (what production's long-lived app.db carries).
        db.execute_unprepared(
            "CREATE TABLE seaql_migrations (version TEXT PRIMARY KEY NOT NULL, applied_at TEXT)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO seaql_migrations (version, applied_at) \
             VALUES ('m20260905_000001_create_users_auth', '1787000000')",
        )
        .await
        .unwrap();

        repair_seaql_migrations_applied_at(&db).await.unwrap();

        // The EXACT decode that crashed v0.5.1: Option<i64> on applied_at.
        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT version, applied_at FROM seaql_migrations".to_string(),
            ))
            .await
            .unwrap()
            .expect("row survived the rebuild");
        let version: String = row.try_get("", "version").unwrap();
        let applied_at: Option<i64> = row.try_get("", "applied_at").unwrap();
        assert_eq!(version, "m20260905_000001_create_users_auth");
        assert_eq!(applied_at, Some(1_787_000_000), "CAST preserved the value");

        // Idempotent: a second pass must not touch anything.
        repair_seaql_migrations_applied_at(&db).await.unwrap();
        let n = db
            .query_all(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT version FROM seaql_migrations".to_string(),
            ))
            .await
            .unwrap()
            .len();
        assert_eq!(n, 1);
    }

    /// A correctly-typed table (every fresh database) is left alone —
    /// the pragma probe is read-only in that case.
    #[tokio::test]
    async fn correct_schema_is_untouched() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        db.execute_unprepared(
            "CREATE TABLE seaql_migrations (version TEXT PRIMARY KEY NOT NULL, applied_at INTEGER)",
        )
        .await
        .unwrap();
        db.execute_unprepared(
            "INSERT INTO seaql_migrations (version, applied_at) VALUES ('m1', 12345)",
        )
        .await
        .unwrap();

        repair_seaql_migrations_applied_at(&db).await.unwrap();

        let row = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT version, applied_at FROM seaql_migrations".to_string(),
            ))
            .await
            .unwrap()
            .expect("row must survive untouched");
        let version: String = row.try_get("", "version").unwrap();
        let applied_at: Option<i64> = row.try_get("", "applied_at").unwrap();
        assert_eq!((version.as_str(), applied_at), ("m1", Some(12345)));
    }

    /// No tracking table yet (a brand-new database): the repair is a
    /// no-op and `run_migrations` proceeds to create everything.
    #[tokio::test]
    async fn fresh_database_migrates_normally() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        run_migrations(&db).await.unwrap();
        // sea-orm-migration created its table and applied every migration.
        let n = db
            .query_all(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT version FROM seaql_migrations".to_string(),
            ))
            .await
            .unwrap()
            .len();
        assert!(n >= 10, "all consolidated migrations applied, got {n}");
    }
}
