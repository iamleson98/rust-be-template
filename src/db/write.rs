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
//!
//! A body must run every statement on its `tx` and never touch the pool
//! (`db`, a store holding it, another `with_write`): that borrows a SECOND
//! connection, which in the `BEGIN IMMEDIATE` attempt waits for the write
//! lock the body's own transaction holds, so it blocks itself for the
//! whole busy timeout, and a handful of such bodies drain the pool. The
//! pools built by [`crate::db::pool`] detect it: a connection checkout
//! while a body runs on the same task panics in debug builds and logs an
//! error in release builds.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::Duration;

use async_trait::async_trait;
use rand::Rng;
use sea_orm::sea_query::Values;
use sea_orm::sqlx::sqlite::SqliteConnectOptions;
use sea_orm::sqlx::{self, Sqlite, SqlitePool, Transaction};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, DbErr, ExecResult, QueryResult,
    RuntimeErr, Statement,
};
use sea_query_binder::SqlxValues;
use tokio::sync::{Mutex, MutexGuard};

use crate::store::{StoreError, StoreResult};

/// Attempts per [`with_write`] call, the last one being `BEGIN IMMEDIATE`.
pub const MAX_ATTEMPTS: usize = 6;

/// Upper bound of the random pause before the first retry, in
/// milliseconds; it doubles with every further retry (see [`backoff`]).
const BACKOFF_BASE_MS: u64 = 10;

/// Doublings stop here: the longest pause is `10 ms << 4` = 160 ms.
const BACKOFF_MAX_DOUBLINGS: usize = 4;

/// Random pause before retry number `retry` (1 for the first retry): up
/// to 10 ms, doubling each time, so writers that keep colliding spread out
/// further apart the longer the collision lasts.
fn backoff(retry: usize) -> Duration {
    let cap_ms = BACKOFF_BASE_MS << (retry - 1).min(BACKOFF_MAX_DOUBLINGS);
    Duration::from_millis(rand::thread_rng().gen_range(1..=cap_ms))
}

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

/// The in-process queue for SQLite's write lock.
///
/// A commit needs SQLite's write lock for a short moment. Left to
/// SQLite's busy handler, writers poll for it with sleeps (up to 100 ms
/// apart) and the unlucky ones time out; queueing them here hands the lock
/// over in order instead (tokio's mutex is FIFO).
///
/// * A `BEGIN CONCURRENT` transaction takes it only for its `COMMIT`
///   statement, never while the body runs.
/// * A `BEGIN IMMEDIATE` transaction takes it BEFORE `BEGIN IMMEDIATE`
///   and keeps it until commit or rollback. It then owns the queue as
///   well as SQLite's lock, so it is not left polling against a stream of
///   queued committers (starvation), and no committer can hold the queue
///   while waiting for a lock the IMMEDIATE transaction owns (deadlock).
///
/// Every transaction therefore acquires queue first, SQLite lock second;
/// that single order cannot form a cycle.
static COMMIT_LOCK: Mutex<()> = Mutex::const_new(());

tokio::task_local! {
    /// Set while a [`with_write`] body runs on this task.
    static IN_WRITE_BODY: ();
}

/// Report a pool checkout (or a nested [`with_write`]) from inside a
/// [`with_write`] body: see the module docs. Called by the pool hooks and
/// by [`ConcurrentTx::begin`]. Panics in debug builds, logs in release.
///
/// Detection covers the body's own task; a task it spawns does not
/// inherit the marker.
pub(crate) fn forbid_inside_write_body(what: &str) {
    if IN_WRITE_BODY.try_with(|_| ()).is_ok() {
        tracing::error!(
            what,
            "database pool used inside a with_write body; run every statement on `tx`"
        );
        debug_assert!(
            false,
            "{what} inside a with_write body: use the `tx` the body was given, never the pool"
        );
    }
}

/// A write transaction on one pooled connection. Implements sea-orm's
/// [`ConnectionTrait`], so entities, `Query` builders and raw statements
/// run on it exactly as they do on a `DatabaseTransaction`.
pub struct ConcurrentTx {
    // Field order matters: on a plain drop the transaction (whose rollback
    // is queued on its connection) goes before the queue turn is released.
    tx: Mutex<Transaction<'static, Sqlite>>,
    /// Held from before `BEGIN IMMEDIATE` until the transaction ends;
    /// `None` for `BEGIN CONCURRENT`, which queues only at commit.
    turn: Option<MutexGuard<'static, ()>>,
    mode: BeginMode,
}

impl ConcurrentTx {
    /// Check out a connection and start a transaction in `mode`.
    ///
    /// An `Immediate` transaction first waits its turn in the write queue
    /// (see [`COMMIT_LOCK`]).
    pub async fn begin(pool: &SqlitePool, mode: BeginMode) -> Result<Self, DbErr> {
        forbid_inside_write_body("starting a write transaction");
        let turn = match mode {
            BeginMode::Immediate => Some(COMMIT_LOCK.lock().await),
            BeginMode::Concurrent => None,
        };
        let tx = pool.begin_with(mode.statement()).await.map_err(exec_err)?;
        Ok(Self {
            tx: Mutex::new(tx),
            turn,
            mode,
        })
    }

    /// Commit. On a conflict (`SQLITE_BUSY_SNAPSHOT`) the transaction is
    /// rolled back and the error returned.
    pub async fn commit(self) -> Result<(), DbErr> {
        let Self { tx, turn, .. } = self;
        // Dropping an uncommitted sqlx transaction rolls it back, which
        // is what the failure path needs.
        let _turn = match turn {
            Some(turn) => turn,
            None => COMMIT_LOCK.lock().await,
        };
        tx.into_inner().commit().await.map_err(exec_err)
    }

    /// How this transaction was started.
    pub fn mode(&self) -> BeginMode {
        self.mode
    }

    /// Roll back, discarding every change.
    pub async fn rollback(self) -> Result<(), DbErr> {
        let Self { tx, turn, .. } = self;
        let outcome = tx.into_inner().rollback().await.map_err(exec_err);
        drop(turn);
        outcome
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
                tokio::time::sleep(backoff(attempt)).await;
                attempt += 1;
            }
            outcome => return outcome,
        }
    }
}

/// Whether a pool's database runs in WAL mode, which `BEGIN CONCURRENT`
/// needs; anything else (in-memory test databases) uses `BEGIN IMMEDIATE`
/// throughout. The journal mode is fixed per pool (the pool's connect
/// options set it), so it is probed once, on one pooled connection, and
/// remembered instead of costing every write an extra checkout and PRAGMA.
///
/// The pool is identified by its connect options: those live exactly as
/// long as the pool does, and holding a `Weak` to them keeps their address
/// from being reused by a newer pool while the entry exists.
async fn supports_concurrent(pool: &SqlitePool) -> StoreResult<bool> {
    static KNOWN: StdMutex<Vec<(Weak<SqliteConnectOptions>, bool)>> = StdMutex::new(Vec::new());

    let key = pool.connect_options();
    let lookup = |known: &[(Weak<SqliteConnectOptions>, bool)]| {
        known
            .iter()
            .find(|(pool_key, _)| std::ptr::eq(pool_key.as_ptr(), Arc::as_ptr(&key)))
            .map(|(_, wal)| *wal)
    };
    if let Some(wal) = lookup(&KNOWN.lock().unwrap_or_else(|e| e.into_inner())) {
        return Ok(wal);
    }

    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(pool)
        .await
        .map_err(|e| StoreError::from(query_err(e)))?;
    let wal = mode.eq_ignore_ascii_case("wal");

    let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(wal) = lookup(&known) {
        return Ok(wal); // another task probed meanwhile
    }
    known.retain(|(pool_key, _)| pool_key.strong_count() > 0);
    known.push((Arc::downgrade(&key), wal));
    Ok(wal)
}

/// One begin / body / commit round.
async fn attempt_once<T, F>(pool: &SqlitePool, mode: BeginMode, body: &mut F) -> StoreResult<T>
where
    F: for<'a> FnMut(&'a ConcurrentTx) -> WriteFuture<'a, T>,
{
    let tx = ConcurrentTx::begin(pool, mode).await?;
    match IN_WRITE_BODY.scope((), body(&tx)).await {
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
        let pool = crate::db::pool::with_guards(SqlitePoolOptions::new())
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
        // even start while the first holds the write lock. (A raw pooled
        // connection shows SQLite's own refusal; `ConcurrentTx::begin`
        // would instead queue behind the first writer's turn.)
        let first = ConcurrentTx::begin(pool, BeginMode::Immediate)
            .await
            .expect("first immediate writer");
        let err = pool
            .begin_with("BEGIN IMMEDIATE")
            .await
            .err()
            .expect("second immediate writer must fail");
        assert!(
            matches!(
                StoreError::from(DbErr::Exec(RuntimeErr::SqlxError(err))),
                StoreError::Busy(_)
            ),
            "expected a lock error"
        );
        first.rollback().await.expect("rollback");
    }

    #[tokio::test]
    async fn immediate_writers_take_turns_instead_of_polling() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let pool = db.get_sqlite_connection_pool();

        let first = ConcurrentTx::begin(pool, BeginMode::Immediate)
            .await
            .expect("first immediate writer");
        let queued = {
            let pool = pool.clone();
            tokio::spawn(async move { ConcurrentTx::begin(&pool, BeginMode::Immediate).await })
        };
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            !queued.is_finished(),
            "must wait for the first writer's turn"
        );
        first.rollback().await.expect("rollback");
        let second = tokio::time::timeout(Duration::from_secs(2), queued)
            .await
            .expect("woken as soon as the first writer ended")
            .expect("task")
            .expect("second immediate writer");
        second.rollback().await.expect("rollback");
    }

    /// The deadlock the queue order fixes, and the starvation it prevents:
    /// an IMMEDIATE transaction holds SQLite's write lock while a
    /// concurrent-mode committer is already waiting to commit. The
    /// committer must queue behind it (not sit on the queue polling for a
    /// lock the IMMEDIATE transaction owns), and both must then finish.
    #[tokio::test]
    async fn a_concurrent_commit_and_an_immediate_transaction_finish_in_turn() {
        let dir = tempfile::tempdir().expect("tempdir");
        // The 5 s busy timeout is far above the bound below: finishing
        // inside it proves nobody waited on SQLite's busy handler.
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let pool = db.get_sqlite_connection_pool();

        let b = ConcurrentTx::begin(pool, BeginMode::Concurrent)
            .await
            .expect("begin B");
        b.execute_unprepared("INSERT INTO t2 (v) VALUES (2)")
            .await
            .expect("B inserts");
        let a = ConcurrentTx::begin(pool, BeginMode::Immediate)
            .await
            .expect("begin A");
        a.execute_unprepared("INSERT INTO t1 (v) VALUES (1)")
            .await
            .expect("A inserts");

        let b_commit = tokio::spawn(b.commit());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            !b_commit.is_finished(),
            "B committed (or failed) while A held the write lock"
        );

        let bound = Duration::from_secs(2);
        tokio::time::timeout(bound, a.commit())
            .await
            .expect("A starved or deadlocked")
            .expect("A commits");
        tokio::time::timeout(bound, b_commit)
            .await
            .expect("B starved or deadlocked")
            .expect("task")
            .expect("B commits after A");
        assert_eq!((count(&db, "t1").await, count(&db, "t2").await), (1, 1));
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
        // Body runs, counted inside the body itself: every run beyond one
        // per increment is a re-run after a conflict.
        let body_runs = Arc::new(AtomicUsize::new(0));

        let mut tasks = Vec::new();
        for _ in 0..16 {
            let (db, body_runs) = (db.clone(), body_runs.clone());
            tasks.push(tokio::spawn(async move {
                for _ in 0..50 {
                    let body_runs = body_runs.clone();
                    with_write(&db, move |tx| {
                        let body_runs = body_runs.clone();
                        Box::pin(async move {
                            body_runs.fetch_add(1, Ordering::SeqCst);
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
            body_runs.load(Ordering::SeqCst) > 16 * 50,
            "16 writers on one row must have conflicted and re-run at least once"
        );
    }

    #[tokio::test]
    async fn persistent_conflicts_commit_through_the_immediate_fallback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let modes = Arc::new(StdMutex::new(Vec::new()));
        let (recorded, other_connection) = (modes.clone(), db.clone());

        with_write(&db, move |tx| {
            let (modes, other_connection) = (recorded.clone(), other_connection.clone());
            Box::pin(async move {
                let n = counter(tx).await;
                let attempt = {
                    let mut modes = modes.lock().expect("modes");
                    modes.push(tx.mode());
                    modes.len()
                };
                // Every concurrent attempt loses: another connection
                // commits to the same row after this snapshot was taken.
                // The final attempt holds the write lock (BEGIN IMMEDIATE),
                // so interfering then would only deadlock on it.
                if attempt < MAX_ATTEMPTS {
                    // From a separate task: it stands for another request,
                    // and (unlike the body's own task) may use the pool.
                    let other = other_connection.clone();
                    tokio::spawn(async move { set_counter(&other, 1000 + attempt as i64).await })
                        .await
                        .expect("interfering task")?;
                }
                set_counter(tx, n + 1).await?;
                Ok(())
            })
        })
        .await
        .expect("the immediate fallback must commit");

        let modes = modes.lock().expect("modes");
        assert_eq!(modes.len(), MAX_ATTEMPTS);
        assert!(modes[..MAX_ATTEMPTS - 1]
            .iter()
            .all(|m| *m == BeginMode::Concurrent));
        assert_eq!(modes[MAX_ATTEMPTS - 1], BeginMode::Immediate);
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

    #[test]
    fn the_pause_before_a_retry_grows() {
        for _ in 0..200 {
            assert!(backoff(1) <= Duration::from_millis(10));
            assert!(backoff(2) <= Duration::from_millis(20));
            assert!(backoff(5) <= Duration::from_millis(160));
            // Capped: a late retry never sleeps longer than 160 ms.
            assert!(backoff(MAX_ATTEMPTS - 1) <= Duration::from_millis(160));
            assert!(backoff(1) >= Duration::from_millis(1));
        }
        // The upper bound really is reached: not a constant small pause.
        assert!((0..500).any(|_| backoff(5) > Duration::from_millis(80)));
    }

    #[tokio::test]
    async fn the_journal_mode_is_probed_once_per_pool() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wal = wal_db(&dir, Duration::from_secs(5), 1).await;
        let memory = Database::connect("sqlite::memory:").await.expect("connect");
        let (wal_pool, memory_pool) = (
            wal.get_sqlite_connection_pool(),
            memory.get_sqlite_connection_pool(),
        );

        assert!(supports_concurrent(wal_pool).await.expect("probe"));
        assert!(!supports_concurrent(memory_pool).await.expect("probe"));

        // The only connection of the WAL pool is checked out: a probe
        // that still ran PRAGMA journal_mode would wait for it forever.
        let _held = wal_pool.acquire().await.expect("acquire");
        let answer =
            tokio::time::timeout(Duration::from_millis(500), supports_concurrent(wal_pool))
                .await
                .expect("the answer must come from memory, not from a connection");
        assert!(answer.expect("known"));
    }

    /// The misuse the module docs warn about: the body reaches for the
    /// pool instead of `tx`.
    #[cfg(debug_assertions)]
    #[tokio::test]
    #[should_panic(expected = "inside a with_write body")]
    async fn using_the_pool_inside_a_body_is_caught() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let sneaky = db.clone();
        let _ = with_write::<(), _>(&db, move |_tx| {
            let sneaky = sneaky.clone();
            Box::pin(async move {
                count(&sneaky, "t1").await; // checks a connection out of the pool
                Ok(())
            })
        })
        .await;
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    #[should_panic(expected = "inside a with_write body")]
    async fn a_nested_with_write_is_caught() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        let inner = db.clone();
        let _ = with_write::<(), _>(&db, move |_tx| {
            let inner = inner.clone();
            Box::pin(
                async move { with_write::<(), _>(&inner, |_tx| Box::pin(async { Ok(()) })).await },
            )
        })
        .await;
    }

    #[tokio::test]
    async fn the_pool_stays_usable_after_a_body_finishes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = wal_db(&dir, Duration::from_secs(5), 4).await;
        with_write(&db, |tx| {
            Box::pin(async move {
                tx.execute_unprepared("INSERT INTO t1 (v) VALUES (1)")
                    .await?;
                Ok(())
            })
        })
        .await
        .expect("write");
        // The marker is scoped to the body: the same task may use the pool
        // again, and a spawned task may use it while a body is running.
        assert_eq!(count(&db, "t1").await, 1);
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
