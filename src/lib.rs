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
//! - `zeroclaw`: pluggable AI customer-support assistant
//! - `rbac`: cached role + permission checker
//! - `auth`: password, JWT, refresh, cookies, SessionUser
//! - `middleware`: rate limit, auth extractors, request id
//! - `routes`: axum handlers + utoipa OpenAPI
//! - `state`: AppState
//! - `server`: bootstrap + run

pub mod audio_call;
pub mod auth;
pub mod cache;
pub mod cli;
pub mod config;
pub mod dto;
pub mod entity;
pub mod error;
pub mod middleware;
pub mod osm;
pub mod rbac;
pub mod routes;
pub mod server;
pub mod service;
pub mod state;
pub mod storage;
pub mod store;
pub mod validation;
pub mod worker;
pub mod ws;
pub mod zeroclaw;

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
