//! 12-factor Rust backend: layered store + RBAC + JWT + WebSocket + worker.
//!
//! Module map:
//! - `config`: typed `.env`-driven config
//! - `error`: unified `AppError` → HTTP response mapping
//! - `entity`: SeaORM entities (mirror of `sea-orm-cli generate entity`)
//! - `migration`: SeaORM migrations (moved to the `migrator` crate)
//! - `cache`: pluggable cache (`MokaBackend` | `RedisBackend`)
//! - `store`: per-entity DB+retry+cache stores composed into one `Store`
//! - `media`: upload re-encoding (WebP) and SVG logo safety check
//! - `storage`: pluggable file storage (`Local` | `S3` | `MinIO`)
//! - `worker`: background jobs — typed `Job`s on a durable queue in the app database
//! - `ws`: in-process WebSocket chat hub (extensible to Redis fan-out)
//! - `audio_call`: WebRTC signaling relay (`/ws-call`)
//! - `geo`: country of an IP address (the Vietnam-only call gate)
//! - `osm`: OSM extract download
//! - `places`: in-process place search (index generations, engine)
//! - `nullclaw`: pluggable AI customer-support assistant
//! - `rbac`: cached role + permission checker
//! - `auth`: password, JWT, refresh, cookies, SessionUser
//! - `middleware`: rate limit, auth extractors, request id
//! - `routes`: axum handlers + utoipa OpenAPI
//! - `state`: AppState
//! - `server`: bootstrap + run

pub mod ads;
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
pub mod geo;
pub mod guard;
pub mod jobs;
pub mod media;
pub mod memory;
pub mod middleware;
pub mod nullclaw;
pub mod osm;
pub mod payment;
pub mod places;
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
pub mod web;
pub mod worker;
pub mod ws;

// Re-export the Migrator from the standalone migrator crate.
pub use migrator::Migrator;

use sea_orm::DatabaseConnection;

/// Apply all pending SeaORM migrations. Idempotent — safe to call on
/// every startup.
pub async fn run_migrations(db: &DatabaseConnection) -> anyhow::Result<()> {
    use sea_orm_migration::MigratorTrait;
    Migrator::up(db, None).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::ConnectionTrait;
    use sea_orm_migration::MigratorTrait;

    async fn applied_versions(db: &DatabaseConnection) -> usize {
        db.query_all(sea_orm::Statement::from_string(
            db.get_database_backend(),
            "SELECT version FROM seaql_migrations".to_string(),
        ))
        .await
        .unwrap()
        .len()
    }

    /// A brand-new database migrates end to end.
    #[tokio::test]
    async fn fresh_database_migrates_normally() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        run_migrations(&db).await.unwrap();
        let n = applied_versions(&db).await;
        assert!(n >= 10, "all consolidated migrations applied, got {n}");
    }

    /// Upgrading a database created by an earlier migrator run needs no
    /// schema repair. The one-time `seaql_migrations.applied_at` TEXT
    /// workaround that used to run here existed only for databases
    /// written by the former pure-Rust engine; on real SQLite
    /// sea-orm-migration itself creates the tracking table with the
    /// column type it later decodes (`Option<i64>`), and nothing else
    /// ever writes that table.
    #[tokio::test]
    async fn upgrade_from_an_earlier_migrator_run_needs_no_repair() {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}?mode=rwc", dir.path().join("up.db").display());

        // "Previous release": only the first migrations are applied.
        let old = sea_orm::Database::connect(&url).await.unwrap();
        Migrator::up(&old, Some(3)).await.unwrap();
        let first = applied_versions(&old).await;
        assert_eq!(first, 3);
        old.close().await.unwrap();

        // "New release" boots on that file and applies the rest.
        let db = sea_orm::Database::connect(&url).await.unwrap();
        let ty: String = db
            .query_one(sea_orm::Statement::from_string(
                db.get_database_backend(),
                "SELECT type FROM pragma_table_info('seaql_migrations') \
                 WHERE name = 'applied_at'"
                    .to_string(),
            ))
            .await
            .unwrap()
            .expect("applied_at column exists")
            .try_get("", "type")
            .unwrap();
        assert!(
            ty.to_ascii_lowercase().contains("int"),
            "applied_at declared {ty:?}, expected an integer type"
        );
        run_migrations(&db).await.unwrap();
        assert!(applied_versions(&db).await > first);

        // And a further boot is a no-op.
        let all = applied_versions(&db).await;
        run_migrations(&db).await.unwrap();
        assert_eq!(applied_versions(&db).await, all);
    }
}
