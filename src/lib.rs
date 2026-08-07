//! 12-factor Rust backend: layered store + RBAC + JWT + WebSocket + worker.
//!
//! Module map:
//! - `config`: typed `.env`-driven config
//! - `error`: unified `AppError` → HTTP response mapping
//! - `entity`: SeaORM entities (mirror of `sea-orm-cli generate entity`)
//! - `migration`: SeaORM migrations
//! - `cache`: pluggable cache (`MokaBackend` | `RedisBackend`)
//! - `store`: `CacheStore<RetryStore<DbStore>>`
//! - `storage`: pluggable file storage (`Local` | `S3` | `MinIO`)
//! - `worker`: pluggable async job broker (`Redis` | `Db` | `Kafka`)
//! - `ws`: in-process WebSocket hub (extensible to Redis fan-out)
//! - `rbac`: cached role + permission checker
//! - `auth`: password, JWT, refresh, cookies, CSRF
//! - `middleware`: rate limit, auth extractors, request id
//! - `routes`: axum handlers + utoipa OpenAPI
//! - `state`: AppState
//! - `server`: bootstrap + run

pub mod auth;
pub mod cache;
pub mod cli;
pub mod config;
pub mod entity;
pub mod error;
pub mod middleware;
pub mod migration;
pub mod rbac;
pub mod routes;
pub mod server;
pub mod service;
pub mod state;
pub mod storage;
pub mod store;
pub mod worker;
pub mod ws;

use sea_orm::DatabaseConnection;

/// Apply all pending SeaORM migrations. Idempotent — safe to call on
/// every startup.
pub async fn run_migrations(db: &DatabaseConnection) -> anyhow::Result<()> {
    use sea_orm_migration::MigratorTrait;
    migration::Migrator::up(db, None).await?;
    Ok(())
}
