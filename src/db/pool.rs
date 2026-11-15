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
use futures::future::BoxFuture;
use sea_orm::sqlx::pool::PoolConnectionMetadata;
use sea_orm::sqlx::sqlite::{
    SqliteConnectOptions, SqliteConnection, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous,
};
use sea_orm::sqlx::{self, ConnectOptions, Connection, TransactionManager as _};
use sea_orm::{DatabaseConnection, SqlxSqliteConnector};

use crate::config::DatabaseConfig;

/// How long a statement waits for SQLite's file locks before failing
/// with SQLITE_BUSY.
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// `PRAGMA mmap_size`: memory-map up to the first 256 MiB of the database
/// file instead of `read()`ing it (address space only; the pages are
/// file-backed and reclaimable).
pub const MMAP_SIZE_BYTES: i64 = 268_435_456;

/// `PRAGMA mmap_size` for the small readiness-lane pool (see
/// [`PoolShape::mmap_size_bytes`]): its connections only ping, so each
/// maps a token amount instead of a second copy of the hot database.
pub const READINESS_MMAP_SIZE_BYTES: i64 = 8_388_608;

/// Pools of at most this many connections are readiness lanes.
const READINESS_POOL_MAX_CONNECTIONS: u32 = 2;

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
    /// `PRAGMA mmap_size` for this pool's connections. Every connection
    /// maps the same file separately, so the mapped pages are counted once
    /// per connection in the process's RSS figure; a pool of at most two
    /// connections is the readiness lane, which only runs health checks
    /// and gets a small mapping.
    pub fn mmap_size_bytes(&self) -> i64 {
        if self.max_connections <= READINESS_POOL_MAX_CONNECTIONS {
            READINESS_MMAP_SIZE_BYTES
        } else {
            MMAP_SIZE_BYTES
        }
    }

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
    connect_options_for(cfg, PoolShape::main(cfg))
}

/// [`connect_options`] for a pool of the given shape.
pub fn connect_options_for(
    cfg: &DatabaseConfig,
    shape: PoolShape,
) -> anyhow::Result<SqliteConnectOptions> {
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
        .pragma("mmap_size", shape.mmap_size_bytes().to_string())
        .pragma("wal_autocheckpoint", WAL_AUTOCHECKPOINT_PAGES.to_string())
        .pragma("journal_size_limit", JOURNAL_SIZE_LIMIT_BYTES.to_string())
        .pragma("soft_heap_limit", SOFT_HEAP_LIMIT_BYTES.to_string());
    Ok(options)
}

/// Attach the pool-level safety hooks to `options`. Every pool that serves
/// write transactions must be built through this (see [`connect`]).
pub(crate) fn with_guards(options: SqlitePoolOptions) -> SqlitePoolOptions {
    options
        .after_release(discard_if_in_transaction)
        .before_acquire(reject_use_inside_write_body)
        .after_connect(reject_connect_inside_write_body)
}

/// `before_acquire` hook: a checkout from inside a `with_write` body is a
/// bug (see `db::write`). Runs on the caller's task, so it can tell.
fn reject_use_inside_write_body(
    _conn: &mut SqliteConnection,
    _meta: PoolConnectionMetadata,
) -> BoxFuture<'_, Result<bool, sqlx::Error>> {
    Box::pin(async {
        super::write::forbid_inside_write_body("checking a connection out of the pool");
        Ok(true)
    })
}

/// The same check for a checkout that opens a NEW connection, which
/// skips `before_acquire`.
fn reject_connect_inside_write_body(
    _conn: &mut SqliteConnection,
    _meta: PoolConnectionMetadata,
) -> BoxFuture<'_, Result<(), sqlx::Error>> {
    Box::pin(async {
        super::write::forbid_inside_write_body("opening a pool connection");
        Ok(())
    })
}

/// `after_release` hook: close a connection that is still inside a
/// transaction instead of returning it to the pool.
///
/// SQLite rolls a transaction back by itself after some errors
/// (`SQLITE_FULL`, `SQLITE_IOERR`, ...). sqlx only lowers its own
/// transaction counter when ITS `ROLLBACK` succeeds, and that statement
/// then fails with "no transaction is active". The connection would go
/// back to the pool with a stale depth and every later `begin_with` on it
/// would fail with `InvalidSavePointStatement` until `max_lifetime`.
/// A connection left in a real open transaction (a leaked `BEGIN`) would
/// hold the database's write lock. Either way a fresh connection is
/// cheaper than guessing.
fn discard_if_in_transaction(
    conn: &mut SqliteConnection,
    _meta: PoolConnectionMetadata,
) -> BoxFuture<'_, Result<bool, sqlx::Error>> {
    Box::pin(async move {
        // Dropping a transaction only QUEUES its rollback on the
        // connection's worker; the pool's own release ping runs after this
        // hook. Flush the queue first so a normal drop is not mistaken for
        // a stuck transaction.
        conn.ping().await?;
        let depth =
            <sqlx::Sqlite as sqlx::Database>::TransactionManager::get_transaction_depth(conn);
        let mut handle = conn.lock_handle().await?;
        // SAFETY: the handle is a live connection locked by `lock_handle`.
        let autocommit =
            unsafe { libsqlite3_sys::sqlite3_get_autocommit(handle.as_raw_handle().as_ptr()) };
        let clean = depth == 0 && autocommit != 0;
        if !clean {
            tracing::warn!(
                depth,
                autocommit,
                "closing a connection released inside a transaction"
            );
        }
        Ok(clean)
    })
}

/// Build a pool whose every connection runs the pragmas of
/// [`connect_options`], and wrap it as a sea-orm connection.
pub async fn connect(cfg: &DatabaseConfig, shape: PoolShape) -> anyhow::Result<DatabaseConnection> {
    let mut options = connect_options_for(cfg, shape)?;
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

    let pool = with_guards(SqlitePoolOptions::new())
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

    /// One connection, so a released connection is certain to be the next
    /// one handed out unless the pool closed it.
    async fn single_connection_pool(dir: &tempfile::TempDir) -> DatabaseConnection {
        let cfg = file_config(dir);
        connect(
            &cfg,
            PoolShape {
                max_connections: 1,
                min_connections: 0,
                sqlx_logging: false,
            },
        )
        .await
        .expect("connect")
    }

    #[tokio::test]
    async fn a_connection_released_inside_a_transaction_is_closed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = single_connection_pool(&dir).await;
        let pool = db.get_sqlite_connection_pool();

        // A leaked raw BEGIN: SQLite is mid-transaction, sqlx does not know.
        let mut conn = pool.acquire().await.expect("acquire");
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *conn)
            .await
            .expect("begin");
        drop(conn);

        // The only connection was closed, so this is a fresh one: a reused
        // one would answer "cannot start a transaction within a transaction".
        let mut fresh = pool.acquire().await.expect("acquire after release");
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *fresh)
            .await
            .expect("the pool handed out a connection that was still in a transaction");
        sqlx::query("ROLLBACK")
            .execute(&mut *fresh)
            .await
            .expect("rollback");
    }

    /// What SQLite's own rollback after SQLITE_FULL / SQLITE_IOERR leaves
    /// behind: no open transaction, but sqlx still counts one.
    #[tokio::test]
    async fn a_connection_with_a_stale_transaction_depth_is_closed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = single_connection_pool(&dir).await;
        let pool = db.get_sqlite_connection_pool();

        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.expect("begin");
        sqlx::query("ROLLBACK")
            .execute(&mut *tx)
            .await
            .expect("SQLite ends the transaction behind sqlx's back");
        drop(tx); // sqlx's queued ROLLBACK now fails; depth stays at 1

        pool.begin_with("BEGIN IMMEDIATE")
            .await
            .expect("a connection with a stale depth was reused")
            .rollback()
            .await
            .expect("rollback");
    }

    #[tokio::test]
    async fn a_dropped_transaction_keeps_its_connection() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = single_connection_pool(&dir).await;
        let pool = db.get_sqlite_connection_pool();
        let first = pool.begin().await.expect("begin");
        drop(first); // rolls back on drop; nothing is wrong with the connection
        let _again = pool.begin().await.expect("begin again");
        assert_eq!(
            pool.size(),
            1,
            "an ordinary rollback must not cost the connection"
        );
    }

    #[tokio::test]
    async fn the_readiness_pool_maps_far_less_than_the_main_pool() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg = file_config(&dir);
        let readiness = connect(
            &cfg,
            PoolShape {
                max_connections: 2,
                min_connections: 1,
                sqlx_logging: false,
            },
        )
        .await
        .expect("connect");
        let mut conn = readiness
            .get_sqlite_connection_pool()
            .acquire()
            .await
            .expect("acquire");
        assert_eq!(pragma(&mut conn, "mmap_size").await, "8388608");
        assert!(READINESS_MMAP_SIZE_BYTES < MMAP_SIZE_BYTES);
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
