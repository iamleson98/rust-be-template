//! Background WAL checkpointing.
//!
//! SQLite's automatic checkpoint (every `wal_autocheckpoint` pages, on
//! commit) is PASSIVE: it never waits for readers and never shrinks the
//! WAL file, so a burst of writes or one long-lived reader can leave a
//! large `-wal` file on disk indefinitely. This task keeps it in check:
//!
//! * `PRAGMA wal_checkpoint(PASSIVE)` every [`PASSIVE_INTERVAL`] moves
//!   committed frames into the main database file without blocking
//!   anyone.
//! * `PRAGMA wal_checkpoint(TRUNCATE)` once a night at
//!   [`TRUNCATE_HOUR`]:00 local time also waits for the readers and
//!   resets the WAL file to zero bytes, returning its disk space.
//!
//! Both are best effort: a failed or `busy` checkpoint is logged and the
//! next tick tries again.

use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Local, NaiveTime, TimeZone};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;

/// How often the cheap PASSIVE checkpoint runs.
pub const PASSIVE_INTERVAL: Duration = Duration::from_secs(60);

/// Local hour of the nightly TRUNCATE checkpoint.
pub const TRUNCATE_HOUR: u32 = 4;

/// Checkpoint flavour — the argument of `PRAGMA wal_checkpoint`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Checkpoint what it can without waiting for readers or writers.
    Passive,
    /// Wait for readers, checkpoint everything, then truncate the WAL
    /// file to zero bytes.
    Truncate,
}

impl Mode {
    fn pragma(self) -> &'static str {
        match self {
            Mode::Passive => "PRAGMA wal_checkpoint(PASSIVE)",
            Mode::Truncate => "PRAGMA wal_checkpoint(TRUNCATE)",
        }
    }
}

/// Result row of `PRAGMA wal_checkpoint`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Outcome {
    /// The checkpoint could not run to completion because a reader or
    /// writer held the WAL (SQLite's `busy` column).
    pub busy: bool,
    /// Frames in the WAL after the checkpoint.
    pub wal_frames: i64,
    /// Frames moved into the database file.
    pub checkpointed_frames: i64,
}

/// Run one checkpoint on a pooled connection.
pub async fn run_once(db: &DatabaseConnection, mode: Mode) -> Result<Outcome, sea_orm::DbErr> {
    let row = db
        .query_one(Statement::from_string(DbBackend::Sqlite, mode.pragma()))
        .await?
        .ok_or_else(|| sea_orm::DbErr::Custom("wal_checkpoint returned no row".into()))?;
    Ok(Outcome {
        busy: row.try_get_by_index::<i64>(0)? != 0,
        wal_frames: row.try_get_by_index(1)?,
        checkpointed_frames: row.try_get_by_index(2)?,
    })
}

/// Start the checkpoint loop; it ends when `shutdown` is cancelled.
pub fn spawn(db: DatabaseConnection, shutdown: CancellationToken) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut passive = tokio::time::interval(PASSIVE_INTERVAL);
        passive.set_missed_tick_behavior(MissedTickBehavior::Delay);
        passive.tick().await; // the first tick fires at once; nothing to do yet

        loop {
            let until_truncate = until_next_truncate(Local::now());
            tokio::select! {
                () = shutdown.cancelled() => return,
                _ = passive.tick() => checkpoint(&db, Mode::Passive).await,
                () = tokio::time::sleep(until_truncate) => {
                    checkpoint(&db, Mode::Truncate).await;
                }
            }
        }
    })
}

async fn checkpoint(db: &DatabaseConnection, mode: Mode) {
    match run_once(db, mode).await {
        Ok(out) if out.busy => {
            tracing::info!(
                ?mode,
                ?out,
                "WAL checkpoint was blocked by a reader or writer"
            );
        }
        Ok(out) if mode == Mode::Truncate => {
            tracing::info!(?out, "nightly WAL truncate checkpoint done");
        }
        Ok(out) => tracing::debug!(?out, "WAL checkpoint done"),
        Err(e) => tracing::warn!(?mode, error = %e, "WAL checkpoint failed"),
    }
}

/// Time from `now` until the next [`TRUNCATE_HOUR`]:00 local time.
fn until_next_truncate(now: DateTime<Local>) -> Duration {
    let at = NaiveTime::from_hms_opt(TRUNCATE_HOUR, 0, 0).expect("TRUNCATE_HOUR is a valid hour");
    let mut day = now.date_naive();
    loop {
        // `earliest` is `None` only when the wall-clock time does not
        // exist (a DST gap); that day is skipped.
        if let Some(target) = Local.from_local_datetime(&day.and_time(at)).earliest() {
            if target > now {
                return (target - now).to_std().unwrap_or(Duration::ZERO);
            }
        }
        day += ChronoDuration::days(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DatabaseConfig;
    use sea_orm::ConnectionTrait;

    fn local(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Local> {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .earliest()
            .expect("valid local time")
    }

    #[test]
    fn next_truncate_is_today_before_four_and_tomorrow_after() {
        assert_eq!(
            until_next_truncate(local(2026, 6, 10, 3, 30)),
            Duration::from_secs(30 * 60)
        );
        assert_eq!(
            until_next_truncate(local(2026, 6, 10, 4, 0)),
            Duration::from_secs(24 * 3600)
        );
        assert_eq!(
            until_next_truncate(local(2026, 6, 10, 23, 0)),
            Duration::from_secs(5 * 3600)
        );
    }

    fn wal_len(dir: &tempfile::TempDir) -> u64 {
        std::fs::metadata(dir.path().join("cp.db-wal"))
            .map(|m| m.len())
            .unwrap_or(0)
    }

    #[tokio::test]
    async fn truncate_shrinks_the_wal_file_and_passive_does_not() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cfg = DatabaseConfig {
            url: format!("sqlite://{}?mode=rwc", dir.path().join("cp.db").display()),
            ..DatabaseConfig::default()
        };
        let db = crate::db::pool::connect(
            &cfg,
            crate::db::pool::PoolShape {
                max_connections: 2,
                min_connections: 1,
                sqlx_logging: false,
            },
        )
        .await
        .expect("connect");
        db.execute_unprepared("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
            .await
            .expect("create");
        for i in 0..50 {
            db.execute_unprepared(&format!("INSERT INTO t (v) VALUES ('row {i}')"))
                .await
                .expect("insert");
        }
        let grown = wal_len(&dir);
        assert!(grown > 0, "writes should have grown the WAL");

        let passive = run_once(&db, Mode::Passive).await.expect("passive");
        assert!(!passive.busy);
        assert_eq!(passive.checkpointed_frames, passive.wal_frames);
        assert_eq!(wal_len(&dir), grown, "PASSIVE must not shrink the file");

        let truncate = run_once(&db, Mode::Truncate).await.expect("truncate");
        assert!(!truncate.busy);
        assert_eq!(wal_len(&dir), 0, "TRUNCATE resets the WAL file");
    }

    #[tokio::test]
    async fn the_task_stops_on_shutdown() {
        let db = sea_orm::Database::connect("sqlite::memory:")
            .await
            .expect("connect");
        let shutdown = CancellationToken::new();
        let task = spawn(db, shutdown.clone());
        shutdown.cancel();
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("task ends after cancel")
            .expect("task did not panic");
    }
}
