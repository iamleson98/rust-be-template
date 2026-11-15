//! SQLite connection pool.
//!
//! Almost every SQLite pragma is per-connection state, so applying them
//! once through "some" pooled connection leaves the rest of the pool on
//! SQLite's defaults. The pool is therefore built here from sqlx connect
//! options: sqlx runs the pragmas on EVERY connection it opens, including
//! ones opened later to replace expired or closed connections.

use std::str::FromStr;
use std::time::Duration;

use anyhow::Context;
use sea_orm::sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
};
use sea_orm::sqlx::{ConnectOptions, Connection};
use sea_orm::{DatabaseConnection, SqlxSqliteConnector};

use crate::config::DatabaseConfig;

/// How long a statement waits for SQLite's file locks before failing
/// with SQLITE_BUSY.
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// `PRAGMA mmap_size`: memory-map up to the first 256 MiB of the database
/// file instead of `read()`ing it (address space only; the pages are
/// file-backed and reclaimable).
pub const MMAP_SIZE_BYTES: i64 = 268_435_456;

/// `PRAGMA wal_autocheckpoint`: WAL pages after which a committing
/// connection runs a passive checkpoint.
pub const WAL_AUTOCHECKPOINT_PAGES: i64 = 1000;

/// `PRAGMA journal_size_limit`: the WAL file is truncated back to at most
/// this size after a checkpoint instead of keeping its high-water mark.
pub const JOURNAL_SIZE_LIMIT_BYTES: i64 = 67_108_864;

/// `PRAGMA soft_heap_limit`: SQLite starts releasing cached pages once
/// its process-wide heap passes this. The pragma is global, not
/// per-connection, but setting it on each connection is harmless.
pub const SOFT_HEAP_LIMIT_BYTES: i64 = 134_217_728;

/// Pool size and logging for one pool; the connection options come from
/// the shared [`DatabaseConfig`].
#[derive(Debug, Clone, Copy)]
pub struct PoolShape {
    pub max_connections: u32,
    pub min_connections: u32,
    pub sqlx_logging: bool,
}

impl PoolShape {
    /// The main application pool, as configured.
    pub fn main(cfg: &DatabaseConfig) -> Self {
        Self {
            max_connections: cfg.max_connections,
            min_connections: cfg.min_connections,
            sqlx_logging: cfg.enable_sqlx_logs,
        }
    }
}

/// Connect options carrying the per-connection pragmas.
///
/// Fails fast on a non-`sqlite:` URL (e.g. a stale postgres one): sqlx
/// would otherwise treat it as a file name.
pub fn connect_options(cfg: &DatabaseConfig) -> anyhow::Result<SqliteConnectOptions> {
    if !cfg.url.starts_with("sqlite:") {
        let scheme = &cfg.url[..cfg.url.find(':').unwrap_or(cfg.url.len())];
        anyhow::bail!(
            "unsupported DATABASE_URL scheme {scheme:?} — this build supports only SQLite; \
             use a sqlite://… URL"
        );
    }
    let options = SqliteConnectOptions::from_str(&cfg.url)
        .context("parsing DATABASE_URL")?
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(BUSY_TIMEOUT)
        .foreign_keys(true)
        .statement_cache_capacity(cfg.statement_cache_capacity)
        .pragma("temp_store", "MEMORY")
        .pragma("cache_size", format!("-{}", cfg.cache_kib))
        .pragma("mmap_size", MMAP_SIZE_BYTES.to_string())
        .pragma("wal_autocheckpoint", WAL_AUTOCHECKPOINT_PAGES.to_string())
        .pragma("journal_size_limit", JOURNAL_SIZE_LIMIT_BYTES.to_string())
        .pragma("soft_heap_limit", SOFT_HEAP_LIMIT_BYTES.to_string());
    Ok(options)
}

/// Build a pool whose every connection runs the pragmas of
/// [`connect_options`], and wrap it as a sea-orm connection.
pub async fn connect(cfg: &DatabaseConfig, shape: PoolShape) -> anyhow::Result<DatabaseConnection> {
    let mut options = connect_options(cfg)?;
    options = if shape.sqlx_logging {
        options
    } else {
        options.disable_statement_logging()
    };

    // Switching a fresh database file into WAL needs an exclusive lock that
    // busy_timeout cannot wait on, so do it on one connection before the
    // pool opens several at once.
    options
        .connect()
        .await
        .context("opening the first database connection")?
        .close()
        .await
        .context("closing the first database connection")?;

    let pool = SqlitePoolOptions::new()
        .max_connections(shape.max_connections)
        .min_connections(shape.min_connections)
        .acquire_timeout(cfg.connect_timeout())
        .idle_timeout(cfg.idle_timeout())
        .max_lifetime(cfg.max_lifetime())
        .connect_with(options)
        .await
        .context("connecting the database pool")?;
    Ok(SqlxSqliteConnector::from_sqlx_sqlite_pool(pool))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_config(dir: &tempfile::TempDir) -> DatabaseConfig {
        DatabaseConfig {
            url: format!("sqlite://{}?mode=rwc", dir.path().join("pool.db").display()),
            max_connections: 8,
            min_connections: 2,
            connect_timeout_secs: 10,
            idle_timeout_secs: 600,
            max_lifetime_secs: 1800,
            statement_cache_capacity: 100,
            cache_kib: 8192,
            enable_sqlx_logs: false,
        }
    }

    async fn pragma(conn: &mut sea_orm::sqlx::SqliteConnection, name: &str) -> String {
        use sea_orm::sqlx::Row;
        let row = sea_orm::sqlx::query(&format!("PRAGMA {name}"))
            .fetch_one(conn)
            .await
            .unwrap_or_else(|e| panic!("PRAGMA {name}: {e}"));
        // PRAGMAs answer integers or text; SQLite converts either to text.
        row.try_get_unchecked::<String, _>(0)
            .unwrap_or_else(|e| panic!("PRAGMA {name} value: {e}"))
    }

    #[tokio::test]
    async fn every_pooled_connection_has_the_pragmas() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg = file_config(&dir);
        let db = connect(&cfg, PoolShape::main(&cfg)).await.expect("connect");
        let pool = db.get_sqlite_connection_pool();

        // Hold all eight at once so each is a distinct connection.
        let mut held = Vec::new();
        for _ in 0..8 {
            held.push(pool.acquire().await.expect("acquire"));
        }
        assert_eq!(pool.size(), 8, "pool should have opened 8 connections");

        let expected = [
            ("journal_mode", "wal"),
            ("synchronous", "1"),
            ("busy_timeout", "5000"),
            ("foreign_keys", "1"),
            ("temp_store", "2"),
            ("cache_size", "-8192"),
            ("mmap_size", "268435456"),
            ("wal_autocheckpoint", "1000"),
            ("journal_size_limit", "67108864"),
            ("soft_heap_limit", "134217728"),
        ];
        for (i, conn) in held.iter_mut().enumerate() {
            for (name, want) in expected {
                assert_eq!(
                    pragma(conn, name).await,
                    want,
                    "connection {i}: PRAGMA {name}"
                );
            }
        }
    }

    #[test]
    fn rejects_a_non_sqlite_url_without_echoing_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut cfg = file_config(&dir);
        cfg.url = "postgres://user:secret@localhost/db".into();
        let err = connect_options(&cfg).expect_err("postgres url must be rejected");
        let msg = format!("{err:#}");
        assert!(msg.contains("postgres"), "{msg}");
        assert!(!msg.contains("secret"), "password leaked: {msg}");
    }
}
