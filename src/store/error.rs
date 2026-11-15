use thiserror::Error;

pub type StoreResult<T> = Result<T, StoreError>;

#[derive(Debug, Clone, Error)]
pub enum StoreError {
    #[error("entity not found: {0}")]
    NotFound(String),

    #[error("database error: {0}")]
    Database(String),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("conflict: {0}")]
    Conflict(String),

    /// SQLite could not take a lock or a consistent snapshot right now
    /// (`SQLITE_BUSY`, `BUSY_SNAPSHOT`, `LOCKED`, …). Transient: the same
    /// operation usually succeeds a moment later.
    #[error("database busy: {0}")]
    Busy(String),

    /// Returned by the retry layer once all attempts are exhausted.
    #[error("operation failed after {retries} retries: {source}")]
    Exhausted {
        retries: usize,
        source: Box<StoreError>,
    },
}

impl StoreError {
    /// Whether the error is worth retrying. Transient DB hiccups return
    /// `true`; logical errors (`NotFound`, `Validation`, `Forbidden`,
    /// `Conflict`, `Exhausted`) return `false`.
    ///
    /// `Busy` is retryable for a single statement. A multi-statement
    /// write transaction must instead re-run its whole body from the top
    /// (`db::write::with_write`), never just the failing statement.
    pub fn is_retryable(&self) -> bool {
        match self {
            StoreError::Database(_) | StoreError::Busy(_) => true,
            StoreError::NotFound(_) => false,
            StoreError::Validation(_) => false,
            StoreError::Forbidden(_) => false,
            StoreError::Conflict(_) => false,
            StoreError::Exhausted { .. } => false,
        }
    }
}

/// SQLite result-code families (the low byte of an extended code).
const SQLITE_BUSY: i32 = 5;
const SQLITE_LOCKED: i32 = 6;
const SQLITE_CONSTRAINT: i32 = 19;

/// Extended `SQLITE_CONSTRAINT_*` codes that mean "this row collides
/// with, or is referenced by, another row" — a caller-visible conflict.
/// The remaining constraint kinds (NOT NULL, CHECK, datatype, …) signal
/// a bug in the code that built the statement and stay internal errors.
const SQLITE_CONSTRAINT_FOREIGNKEY: i32 = 787;
const SQLITE_CONSTRAINT_PRIMARYKEY: i32 = 1555;
const SQLITE_CONSTRAINT_UNIQUE: i32 = 2067;
const SQLITE_CONSTRAINT_ROWID: i32 = 2579;

/// The SQLite extended result code behind a sea-orm error, if it came
/// from SQLite at all (sqlx opens every connection with extended codes
/// on).
pub fn sqlite_error_code(e: &sea_orm::DbErr) -> Option<i32> {
    use sea_orm::{DbErr, RuntimeErr};
    let (DbErr::Conn(RuntimeErr::SqlxError(err))
    | DbErr::Exec(RuntimeErr::SqlxError(err))
    | DbErr::Query(RuntimeErr::SqlxError(err))) = e
    else {
        return None;
    };
    err.as_database_error()?.code()?.parse().ok()
}

/// Message of the `Conflict` a UNIQUE / PRIMARY KEY / ROWID collision maps to.
const RECORD_EXISTS: &str = "record already exists";

impl StoreError {
    /// Whether this is the generic conflict a UNIQUE / PRIMARY KEY
    /// collision maps to (as opposed to a `Conflict` a store raised
    /// itself with its own message). Lets a caller that knows WHICH
    /// unique index it hit replace the generic text with a precise one.
    pub fn is_record_exists(&self) -> bool {
        matches!(self, StoreError::Conflict(msg) if msg == RECORD_EXISTS)
    }

    /// Map a SQLite result code (plus the original message) to the
    /// matching variant: lock/snapshot failures become `Busy`, row
    /// collisions `Conflict`; anything else is `None`.
    fn from_sqlite_code(code: i32, message: &str) -> Option<Self> {
        match code & 0xff {
            SQLITE_BUSY | SQLITE_LOCKED => Some(StoreError::Busy(message.to_string())),
            SQLITE_CONSTRAINT => {
                let what = match code {
                    SQLITE_CONSTRAINT_UNIQUE
                    | SQLITE_CONSTRAINT_PRIMARYKEY
                    | SQLITE_CONSTRAINT_ROWID => RECORD_EXISTS,
                    SQLITE_CONSTRAINT_FOREIGNKEY => {
                        "record is referenced by, or refers to, another record"
                    }
                    _ => return None,
                };
                // The SQL-level detail (table and column names) stays in
                // the log; the variant carries a client-safe sentence.
                tracing::debug!(code, error = message, "database constraint violation");
                Some(StoreError::Conflict(what.to_string()))
            }
            _ => None,
        }
    }
}

impl From<sea_orm::DbErr> for StoreError {
    fn from(e: sea_orm::DbErr) -> Self {
        if matches!(e, sea_orm::DbErr::RecordNotFound(_)) {
            return StoreError::NotFound(e.to_string());
        }
        sqlite_error_code(&e)
            .and_then(|code| StoreError::from_sqlite_code(code, &e.to_string()))
            // Anything else (connection errors, I/O, …) is a generic,
            // retryable database error.
            .unwrap_or_else(|| StoreError::Database(e.to_string()))
    }
}

impl From<sea_orm::TransactionError<StoreError>> for StoreError {
    fn from(e: sea_orm::TransactionError<StoreError>) -> Self {
        match e {
            sea_orm::TransactionError::Connection(e) => e.into(),
            sea_orm::TransactionError::Transaction(e) => e,
        }
    }
}

impl From<anyhow::Error> for StoreError {
    fn from(e: anyhow::Error) -> Self {
        // Try to downcast to a StoreError first (preserves structured variants).
        if let Some(store_err) = e.downcast_ref::<StoreError>() {
            return store_err.clone();
        }
        // Otherwise, treat as a generic database error.
        StoreError::Database(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;
    use std::error::Error as StdError;
    use std::fmt;

    use sea_orm::sqlx::error::{DatabaseError, ErrorKind};
    use sea_orm::{DbErr, RuntimeErr};

    use super::*;

    /// A sqlx database error that reports a chosen SQLite result code.
    #[derive(Debug)]
    struct FakeSqliteError {
        code: i32,
        message: String,
    }

    impl fmt::Display for FakeSqliteError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(&self.message)
        }
    }

    impl StdError for FakeSqliteError {}

    impl DatabaseError for FakeSqliteError {
        fn message(&self) -> &str {
            &self.message
        }
        fn code(&self) -> Option<Cow<'_, str>> {
            Some(Cow::Owned(self.code.to_string()))
        }
        fn as_error(&self) -> &(dyn StdError + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn StdError + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn StdError + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> ErrorKind {
            ErrorKind::Other
        }
    }

    fn exec_err(code: i32, message: &str) -> DbErr {
        DbErr::Exec(RuntimeErr::SqlxError(sea_orm::sqlx::Error::Database(
            Box::new(FakeSqliteError {
                code,
                message: message.to_string(),
            }),
        )))
    }

    #[test]
    fn lock_and_snapshot_failures_are_busy() {
        // BUSY, BUSY_RECOVERY, BUSY_SNAPSHOT, BUSY_TIMEOUT, LOCKED,
        // LOCKED_SHAREDCACHE.
        for code in [5, 261, 517, 773, 6, 262] {
            let err = StoreError::from(exec_err(code, "database is locked"));
            assert!(matches!(err, StoreError::Busy(_)), "code {code}: {err:?}");
            assert!(err.is_retryable(), "code {code} must be retryable");
        }
    }

    #[test]
    fn row_collisions_are_conflicts_not_retried() {
        for (code, text) in [
            (2067, "UNIQUE constraint failed: user.email"),
            (1555, "UNIQUE constraint failed: user.id"),
            (2579, "UNIQUE constraint failed: user.rowid"),
        ] {
            let err = StoreError::from(exec_err(code, text));
            assert!(err.is_record_exists(), "code {code}: {err:?}");
            assert!(!err.is_retryable(), "code {code} must not be retried");
            assert!(!err.to_string().contains("user"), "leaks SQL detail: {err}");
        }
        let fk = StoreError::from(exec_err(787, "FOREIGN KEY constraint failed"));
        assert!(matches!(fk, StoreError::Conflict(_)), "{fk:?}");
        assert!(!fk.is_record_exists(), "an FK conflict is not a duplicate");
        assert!(!fk.is_retryable());
    }

    #[test]
    fn other_constraints_and_errors_stay_internal() {
        // NOT NULL, CHECK: bugs in the statement, not caller-visible.
        for code in [1299, 275] {
            let err = StoreError::from(exec_err(code, "constraint failed"));
            assert!(
                matches!(err, StoreError::Database(_)),
                "code {code}: {err:?}"
            );
        }
        let io = StoreError::from(exec_err(10, "disk I/O error"));
        assert!(matches!(io, StoreError::Database(_)), "{io:?}");
        let not_found = StoreError::from(DbErr::RecordNotFound("x".into()));
        assert!(matches!(not_found, StoreError::NotFound(_)));
        let custom = StoreError::from(DbErr::Custom("boom".into()));
        assert!(matches!(custom, StoreError::Database(_)));
    }

    #[test]
    fn a_store_raised_conflict_is_not_the_generic_one() {
        let own = StoreError::Conflict("seat already taken".into());
        assert!(!own.is_record_exists());
    }

    #[tokio::test]
    async fn real_sqlite_errors_map_through_the_same_path() {
        use sea_orm::{ConnectionTrait, Database};
        let db = Database::connect("sqlite::memory:").await.expect("connect");
        db.execute_unprepared("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT UNIQUE)")
            .await
            .expect("create");
        db.execute_unprepared("INSERT INTO t (email) VALUES ('a@b.c')")
            .await
            .expect("insert");
        let dup = db
            .execute_unprepared("INSERT INTO t (email) VALUES ('a@b.c')")
            .await
            .expect_err("duplicate email");
        assert_eq!(sqlite_error_code(&dup), Some(SQLITE_CONSTRAINT_UNIQUE));
        assert!(StoreError::from(dup).is_record_exists());
    }

    #[tokio::test]
    async fn a_real_lock_timeout_is_busy() {
        use sea_orm::sqlx::sqlite::SqliteConnectOptions;
        use sea_orm::sqlx::{ConnectOptions, Connection};
        use std::time::Duration;

        let dir = tempfile::tempdir().expect("tempdir");
        let options = SqliteConnectOptions::new()
            .filename(dir.path().join("busy.db"))
            .create_if_missing(true)
            .journal_mode(sea_orm::sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(Duration::ZERO);
        let mut holder = options.connect().await.expect("holder");
        let mut other = options.connect().await.expect("other");
        sea_orm::sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .execute(&mut holder)
            .await
            .expect("create");
        sea_orm::sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut holder)
            .await
            .expect("holder takes the write lock");
        let blocked = sea_orm::sqlx::query("INSERT INTO t (id) VALUES (1)")
            .execute(&mut other)
            .await
            .expect_err("second writer must be refused");
        let err = StoreError::from(DbErr::Exec(RuntimeErr::SqlxError(blocked)));
        assert!(matches!(err, StoreError::Busy(_)), "{err:?}");
        holder.close().await.expect("close");
    }
}
