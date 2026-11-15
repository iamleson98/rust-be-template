//! Write transactions on SQLite's `BEGIN CONCURRENT`.
//!
//! Plain SQLite allows one writer at a time: every write transaction
//! takes the database's write lock when it starts and holds it until it
//! ends, so writers queue behind each other for their whole duration. On
//! the `begin-concurrent` branch a `BEGIN CONCURRENT` transaction takes
//! no lock while it runs. It reads from a snapshot, buffers its changes,
//! and at `COMMIT` briefly takes the write lock and checks that no page
//! it touched was changed by a transaction that committed in the
//! meantime. If one was, the commit fails with `SQLITE_BUSY_SNAPSHOT`
//! (517) and nothing is applied.
//!
//! [`with_write`] turns that into an ordinary transaction API: it runs
//! the body, commits, and on a conflict rolls back and runs the whole body
//! again from the start. Consequently the body must be re-runnable: read
//! what it needs inside the transaction (a retry sees the winner's
//! rows) and keep side effects (HTTP calls, websocket pushes, queued
//! jobs) for after `with_write` returns.
//!
//! The last attempt uses `BEGIN IMMEDIATE` instead, which takes the write
//! lock up front and waits for it (`busy_timeout`), so a write that keeps
//! losing against other writers still completes. Databases that are not
//! in WAL mode (in-memory test databases) cannot run `BEGIN CONCURRENT`
//! and always use `BEGIN IMMEDIATE`.
//!
//! DDL and migrations do not belong here: they use the plain connection.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use rand::Rng;
use sea_orm::sea_query::Values;
use sea_orm::sqlx::{self, Sqlite, SqlitePool, Transaction};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, DbErr, ExecResult, QueryResult,
    RuntimeErr, Statement,
};
use sea_query_binder::SqlxValues;
use tokio::sync::Mutex;

use crate::store::{StoreError, StoreResult};

/// Attempts per [`with_write`] call, the last one being `BEGIN IMMEDIATE`.
pub const MAX_ATTEMPTS: usize = 6;

/// Bounds of the random pause before a retry, in milliseconds.
const BACKOFF_MS: std::ops::RangeInclusive<u64> = 1..=20;

/// How a write transaction starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeginMode {
    /// `BEGIN CONCURRENT`: no lock until commit; conflicts fail the commit.
    Concurrent,
    /// `BEGIN IMMEDIATE`: the write lock up front, waited for.
    Immediate,
}

impl BeginMode {
    fn statement(self) -> &'static str {
        match self {
            BeginMode::Concurrent => "BEGIN CONCURRENT",
            BeginMode::Immediate => "BEGIN IMMEDIATE",
        }
    }
}

/// Counters over every [`with_write`] call since process start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteStats {
    /// Transactions re-run because of a lock or snapshot conflict.
    pub retries: u64,
    /// Calls whose final `BEGIN IMMEDIATE` attempt ran.
    pub immediate_fallbacks: u64,
}

static RETRIES: AtomicU64 = AtomicU64::new(0);
static IMMEDIATE_FALLBACKS: AtomicU64 = AtomicU64::new(0);

/// Snapshot of the process-wide write counters.
pub fn write_stats() -> WriteStats {
    WriteStats {
        retries: RETRIES.load(Ordering::Relaxed),
        immediate_fallbacks: IMMEDIATE_FALLBACKS.load(Ordering::Relaxed),
    }
}

/// Serializes `COMMIT`s of concurrent transactions within the process.
///
/// A commit needs SQLite's write lock for a short moment. Left to
/// SQLite's busy handler, many committers poll for it with sleeps and
/// the unlucky ones time out; queueing them here hands the lock over in
/// order instead. It is held only for the `COMMIT` statement, never
/// while a body runs, and only by `BEGIN CONCURRENT` transactions: a
/// `BEGIN IMMEDIATE` transaction already owns SQLite's write lock, so
/// making it queue here while a queued committer waits for that very lock
/// would deadlock until the busy timeout.
static COMMIT_LOCK: Mutex<()> = Mutex::const_new(());

/// A write transaction on one pooled connection. Implements sea-orm's
/// [`ConnectionTrait`], so entities, `Query` builders and raw statements
/// run on it exactly as they do on a `DatabaseTransaction`.
pub struct ConcurrentTx {
    tx: Mutex<Transaction<'static, Sqlite>>,
    mode: BeginMode,
}

impl ConcurrentTx {
    /// Check out a connection and start a transaction in `mode`.
    pub async fn begin(pool: &SqlitePool, mode: BeginMode) -> Result<Self, DbErr> {
        let tx = pool.begin_with(mode.statement()).await.map_err(exec_err)?;
        Ok(Self {
            tx: Mutex::new(tx),
            mode,
        })
    }

    /// Commit. On a conflict (`SQLITE_BUSY_SNAPSHOT`) the transaction is
    /// rolled back and the error returned.
    pub async fn commit(self) -> Result<(), DbErr> {
        let tx = self.tx.into_inner();
        // Dropping an uncommitted sqlx transaction rolls it back, which
        // is what the failure path needs.
        let _commit_turn = match self.mode {
            BeginMode::Concurrent => Some(COMMIT_LOCK.lock().await),
            BeginMode::Immediate => None,
        };
        tx.commit().await.map_err(exec_err)
    }

    /// Roll back, discarding every change.
    pub async fn rollback(self) -> Result<(), DbErr> {
        self.tx.into_inner().rollback().await.map_err(exec_err)
    }
}

fn exec_err(e: sqlx::Error) -> DbErr {
    DbErr::Exec(RuntimeErr::SqlxError(e))
}

fn query_err(e: sqlx::Error) -> DbErr {
    DbErr::Query(RuntimeErr::SqlxError(e))
}

/// Bind a sea-orm statement's values to an sqlx query.
fn bind(stmt: &Statement) -> sqlx::query::Query<'_, Sqlite, SqlxValues> {
    let values = stmt.values.clone().unwrap_or(Values(Vec::new()));
    sqlx::query_with(&stmt.sql, SqlxValues(values))
}

#[async_trait]
impl ConnectionTrait for ConcurrentTx {
    fn get_database_backend(&self) -> DatabaseBackend {
        DatabaseBackend::Sqlite
    }

    async fn execute(&self, stmt: Statement) -> Result<ExecResult, DbErr> {
        let mut tx = self.tx.lock().await;
        let done = bind(&stmt).execute(&mut **tx).await.map_err(exec_err)?;
        Ok(done.into())
    }

    async fn execute_unprepared(&self, sql: &str) -> Result<ExecResult, DbErr> {
        use sqlx::Executor;
        let mut tx = self.tx.lock().await;
        let done = (&mut **tx).execute(sql).await.map_err(exec_err)?;
        Ok(done.into())
    }

    async fn query_one(&self, stmt: Statement) -> Result<Option<QueryResult>, DbErr> {
        let mut tx = self.tx.lock().await;
        let row = bind(&stmt)
            .fetch_optional(&mut **tx)
            .await
            .map_err(query_err)?;
        Ok(row.map(QueryResult::from))
    }

    async fn query_all(&self, stmt: Statement) -> Result<Vec<QueryResult>, DbErr> {
        let mut tx = self.tx.lock().await;
        let rows = bind(&stmt).fetch_all(&mut **tx).await.map_err(query_err)?;
        Ok(rows.into_iter().map(QueryResult::from).collect())
    }
}

/// The boxed future a [`with_write`] body returns, borrowing the
/// transaction it runs on.
pub type WriteFuture<'a, T> = Pin<Box<dyn Future<Output = StoreResult<T>> + Send + 'a>>;

/// Run `body` in a write transaction and commit, retrying the whole
/// transaction when SQLite reports a conflict.
///
/// ```ignore
/// let seat = with_write(&db, |tx| Box::pin(async move {
///     // reads and writes on `tx`
///     Ok(seat)
/// })).await?;
/// ```
///
/// `body` runs again from the top on every retry, so it must only touch
/// the database through `tx` and defer side effects until this returns
/// (see the module docs). It is called once per attempt: clone the owned
/// data the future needs inside the closure (references to the caller's
/// locals cannot be captured by a future that must live for any
/// borrow of `tx`). A body error other than a lock conflict aborts
/// at once, rolling back. After [`MAX_ATTEMPTS`] attempts the last
/// conflict is returned as [`StoreError::Exhausted`], which callers do
/// not retry again.
pub async fn with_write<T, F>(db: &DatabaseConnection, mut body: F) -> StoreResult<T>
where
    F: for<'a> FnMut(&'a ConcurrentTx) -> WriteFuture<'a, T>,
{
    let pool = db.get_sqlite_connection_pool();
    let concurrent_ok = supports_concurrent(pool).await?;
    let mut attempt = 1;
    loop {
        let mode = if concurrent_ok && attempt < MAX_ATTEMPTS {
            BeginMode::Concurrent
        } else {
            BeginMode::Immediate
        };
        if concurrent_ok && mode == BeginMode::Immediate {
            IMMEDIATE_FALLBACKS.fetch_add(1, Ordering::Relaxed);
        }
        match attempt_once(pool, mode, &mut body).await {
            Err(StoreError::Busy(detail)) => {
                if attempt >= MAX_ATTEMPTS {
                    return Err(StoreError::Exhausted {
                        retries: attempt - 1,
                        source: Box::new(StoreError::Busy(detail)),
                    });
                }
                RETRIES.fetch_add(1, Ordering::Relaxed);
                let pause = rand::thread_rng().gen_range(BACKOFF_MS);
                tokio::time::sleep(Duration::from_millis(pause)).await;
                attempt += 1;
            }
            outcome => return outcome,
        }
    }
}

/// `BEGIN CONCURRENT` only works in WAL mode; anything else (in-memory
/// databases in tests) falls back to `BEGIN IMMEDIATE` throughout.
async fn supports_concurrent(pool: &SqlitePool) -> StoreResult<bool> {
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(pool)
        .await
        .map_err(|e| StoreError::from(query_err(e)))?;
    Ok(mode.eq_ignore_ascii_case("wal"))
}

/// One begin / body / commit round.
async fn attempt_once<T, F>(pool: &SqlitePool, mode: BeginMode, body: &mut F) -> StoreResult<T>
where
    F: for<'a> FnMut(&'a ConcurrentTx) -> WriteFuture<'a, T>,
{
    let tx = ConcurrentTx::begin(pool, mode).await?;
    match body(&tx).await {
        Ok(value) => {
            tx.commit().await?;
            Ok(value)
        }
        Err(e) => {
            if let Err(rollback_err) = tx.rollback().await {
                tracing::warn!(error = %rollback_err, "rollback after a failed write body");
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    use sea_orm::sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
    use sea_orm::{Database, SqlxSqliteConnector, Value};

    use super::*;
    use crate::store::sqlite_error_code;

    /// Real WAL database file with tables `t1`, `t2` and a one-row
    /// counter `c`, behind a pool of `max` connections.
    async fn wal_db(
        dir: &tempfile::TempDir,
        busy_timeout: Duration,
        max: u32,
    ) -> DatabaseConnection {
        let options = SqliteConnectOptions::new()
            .filename(dir.path().join("write.db"))
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(busy_timeout);
        let pool = SqlitePoolOptions::new()
            .max_connections(max)
            .connect_with(options)
            .await
            .expect("pool");
        let db = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool);
        db.execute_unprepared(
            "CREATE TABLE t1 (id INTEGER PRIMARY KEY, v INTEGER);
             CREATE TABLE t2 (id INTEGER PRIMARY KEY, v INTEGER);
             CREATE TABLE c (id INTEGER PRIMARY KEY, n INTEGER NOT NULL);
             INSERT INTO c (id, n) VALUES (1, 0);",
        )
        .await
        .expect("schema");
        db
    }

    async fn counter(db: &impl ConnectionTrait) -> i64 {
        let row = db
            .query_one(Statement::from_string(
                DatabaseBackend::Sqlite,
                "SELECT n FROM c WHERE id = 1",
            ))
            .await
            .expect("select")
            .expect("counter row");
        row.try_get_by_index(0).expect("n")
    }

    async fn set_counter(db: &impl ConnectionTrait, n: i64) -> Result<ExecResult, DbErr> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "UPDATE c SET n = ? WHERE id = 1",
            [Value::BigInt(Some(n))],
        ))
        .await
    }

    async fn count(db: &DatabaseConnection, table: &str) -> i64 {
        let row = db
            .query_one(Statement::from_string(
                DatabaseBackend::Sqlite,
                format!("SELECT COUNT(*) FROM {table}"),
            ))
            .await
            .expect("count")
            .expect("row");
        row.try_get_by_index(0).expect("count value")
    }

    #[tokio::test]
    async fn concurrent_writers_to_different_tables_both_commit() {
        let dir = tempfile::tempdir().expect("tempdir");
        // busy_timeout 0: any wait for the write lock fails at once.
        let db = wal_db(&dir, Duration::ZERO, 4).await;
        let pool = db.get_sqlite_connection_pool();

        let a = ConcurrentTx::begin(pool, BeginMode::Concurrent)
            .await
            .expect("begin A");
        a.execute_unprepared("INSERT INTO t1 (v) VALUES (1)")
            .await
            .expect("A inserts");

        // B starts, writes and commits while A is still open and uncommitted.
        let b = ConcurrentTx::begin(pool, BeginMode::Concurrent)
            .await
            .expect("begin B");
        b.execute_unprepared("INSERT INTO t2 (v) VALUES (2)")
            .await
            .expect("B inserts");
        b.commit().await.expect("B commits while A is open");
        a.commit().await.expect("A commits after B");
        assert_eq!((count(&db, "t1").await, count(&db, "t2").await), (1, 1));

        // The contrast: with BEGIN IMMEDIATE the second writer cannot
        // even start while the first holds the write lock.
        let first = ConcurrentTx::begin(pool, BeginMode::Immediate)
            .await
            .expect("first immediate writer");
        let second = ConcurrentTx::begin(pool, BeginMode::Immediate).await;
        let err = second.err().expect("second immediate writer must fail");
        assert!(
            matches!(StoreError::from(err), StoreError::Busy(_)),
            "expected a lock error"
        );
        first.rollback().await.expect("rollback");
    }

    #[tokio::test]
    async fn overlapping_updates_of_one_row_conflict_at_commit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let pool = db.get_sqlite_connection_pool();

        let a = ConcurrentTx::begin(pool, BeginMode::Concurrent)
            .await
            .expect("begin A");
        let b = ConcurrentTx::begin(pool, BeginMode::Concurrent)
            .await
            .expect("begin B");
        let (seen_a, seen_b) = (counter(&a).await, counter(&b).await);
        set_counter(&a, seen_a + 1).await.expect("A updates");
        set_counter(&b, seen_b + 1).await.expect("B updates");

        a.commit().await.expect("A commits first");
        let err = b.commit().await.expect_err("B read a stale snapshot");
        assert_eq!(sqlite_error_code(&err), Some(517), "SQLITE_BUSY_SNAPSHOT");
        assert!(matches!(StoreError::from(err), StoreError::Busy(_)));
        assert_eq!(counter(&db).await, 1, "only A's update applied");
    }

    #[tokio::test]
    async fn sixteen_tasks_of_fifty_increments_lose_no_update() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = Arc::new(wal_db(&dir, Duration::from_secs(5), 8).await);
        let retries_before = write_stats().retries;

        let mut tasks = Vec::new();
        for _ in 0..16 {
            let db = db.clone();
            tasks.push(tokio::spawn(async move {
                for _ in 0..50 {
                    with_write(&db, |tx| {
                        Box::pin(async move {
                            let n = counter(tx).await;
                            set_counter(tx, n + 1).await?;
                            Ok(())
                        })
                    })
                    .await
                    .expect("increment");
                }
            }));
        }
        for task in tasks {
            task.await.expect("task");
        }

        assert_eq!(counter(db.as_ref()).await, 16 * 50);
        assert!(
            write_stats().retries > retries_before,
            "16 writers on one row must have conflicted at least once"
        );
    }

    #[tokio::test]
    async fn persistent_conflicts_commit_through_the_immediate_fallback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let fallbacks_before = write_stats().immediate_fallbacks;
        let attempts = Arc::new(AtomicUsize::new(0));
        let (counted, other_connection) = (attempts.clone(), db.clone());

        with_write(&db, move |tx| {
            let (attempts, other_connection) = (counted.clone(), other_connection.clone());
            Box::pin(async move {
                let n = counter(tx).await;
                // Every concurrent attempt loses: another connection
                // commits to the same row after this snapshot was taken.
                // The final attempt holds the write lock (BEGIN IMMEDIATE),
                // so interfering then would only deadlock on it.
                let attempt = attempts.fetch_add(1, Ordering::SeqCst) + 1;
                if attempt < MAX_ATTEMPTS {
                    set_counter(&other_connection, 1000 + attempt as i64).await?;
                }
                set_counter(tx, n + 1).await?;
                Ok(())
            })
        })
        .await
        .expect("the immediate fallback must commit");

        assert_eq!(attempts.load(Ordering::SeqCst), MAX_ATTEMPTS);
        assert!(write_stats().immediate_fallbacks > fallbacks_before);
        // The last attempt re-read the row the interference left behind.
        assert_eq!(counter(&db).await, 1000 + (MAX_ATTEMPTS as i64 - 1) + 1);
    }

    #[tokio::test]
    async fn a_body_error_rolls_back_without_retrying() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let attempts = Arc::new(AtomicUsize::new(0));
        let counted = attempts.clone();
        let err = with_write::<(), _>(&db, move |tx| {
            let attempts = counted.clone();
            Box::pin(async move {
                attempts.fetch_add(1, Ordering::SeqCst);
                tx.execute_unprepared("INSERT INTO t1 (v) VALUES (1)")
                    .await?;
                Err(StoreError::Validation("nope".into()))
            })
        })
        .await
        .expect_err("body failed");

        assert!(matches!(err, StoreError::Validation(_)), "{err:?}");
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert_eq!(count(&db, "t1").await, 0, "the insert was rolled back");
    }

    #[tokio::test]
    async fn endless_conflicts_end_in_exhausted_which_is_not_retried() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let attempts = Arc::new(AtomicUsize::new(0));
        let counted = attempts.clone();
        let err = with_write::<(), _>(&db, move |_tx| {
            let attempts = counted.clone();
            Box::pin(async move {
                attempts.fetch_add(1, Ordering::SeqCst);
                Err(StoreError::Busy("database is locked".into()))
            })
        })
        .await
        .expect_err("never succeeds");

        assert_eq!(attempts.load(Ordering::SeqCst), MAX_ATTEMPTS);
        match &err {
            StoreError::Exhausted { retries, source } => {
                assert_eq!(*retries, MAX_ATTEMPTS - 1);
                assert!(matches!(**source, StoreError::Busy(_)));
            }
            other => panic!("expected Exhausted, got {other:?}"),
        }
        assert!(!err.is_retryable());
    }

    #[tokio::test]
    async fn in_memory_databases_use_begin_immediate() {
        let db = Database::connect("sqlite::memory:").await.expect("connect");
        db.execute_unprepared("CREATE TABLE t1 (id INTEGER PRIMARY KEY, v INTEGER)")
            .await
            .expect("create");

        with_write(&db, |tx| {
            Box::pin(async move {
                tx.execute_unprepared("INSERT INTO t1 (v) VALUES (1)")
                    .await?;
                Ok(())
            })
        })
        .await
        .expect("write on an in-memory database");
        assert_eq!(count(&db, "t1").await, 1);
    }
}
