use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::sea_query::{Expr, Query, SelectStatement};
use sea_orm::{ConnectionTrait, DatabaseConnection};
use tokio::sync::Notify;
use uuid::Uuid;

use super::backend::{JobEnvelope, WorkerBroker};

/// In-DB job queue on the rust-sql (rustqlite) engine.
///
/// - Single-writer: the engine serializes writes; no `FOR UPDATE SKIP
///   LOCKED` so concurrent workers don't race on the same row.
///   (`PERF-003` fix: the previous build of the `select_oldest` statement
///   was discarded via `let _ = select_oldest`, so the DELETE's inner
///   SELECT had no lock — two workers racing on the same job meant one
///   affected 0 rows + the other waited ~1s before retrying.)
/// - **SQLite**: uses an atomic `DELETE ... RETURNING *` with a
///   rowid-based claim. SQLite locks the whole database during writes,
///   so concurrent dequeues are safe without SKIP LOCKED (just slower
///   under contention).
/// - **Worker wakeup** (`PERF-005` fix): `enqueue` calls
///   `self.wake.notify_one()` after the INSERT so the runner's
///   `select!` arm wakes immediately instead of waiting up to
///   `poll_interval` (1s by default). Cuts end-to-end background-job
///   latency from ~1000ms to ~5-50ms on the DbBroker path.
/// - **Adaptive idle backoff**: an EMPTY queue stretches the sleep
///   exponentially (1s → 2s → … capped at `idle_poll_max`, 30s by
///   default) while any job arrival still wakes the poller via the
///   `Notify` — so idle RSS churn drops ~20x (four workers re-building
///   the DELETE/RETURNING statement every second is the dominant
///   idle allocator load, and mimalloc's `purge_delay=-1` retention
///   turns that churn into a gradual RSS creep; see src/memory.rs)
///   without giving up sub-second job pickup.
///
/// The table schema is created lazily on first use with portable types.
pub struct DbBroker {
    db: Arc<DatabaseConnection>,
    poll_interval: Duration,
    /// Upper bound for the exponential idle-backoff sleep. `ZERO`
    /// disables the backoff (every empty poll waits exactly
    /// `poll_interval`) — the shape tests use to keep polling tight.
    idle_poll_max: Duration,
    /// Consecutive empty dequeues across all workers of this broker.
    /// Reset to 0 the moment a job is claimed; only ever grows while
    /// the queue is genuinely empty.
    idle_streak: AtomicU64,
    /// Used by the runner to break out of `sleep(poll_interval)` on
    /// shutdown. We also `notify_one()` on enqueue so workers wake up
    /// immediately when a job is available (PERF-005 fix).
    wake: Arc<Notify>,
}

/// Exponential idle-backoff sleep for empty dequeues.
///
/// Pure time-math (unit-tested): the n-th consecutive empty poll waits
/// `base * 2^(n-1)`, clamped to `max`. `max == ZERO` disables the
/// backoff (returns `base` for every streak). The first empty poll
/// always waits exactly `base` — a transient blip must not pay a
/// doubled latency.
fn idle_backoff(base: Duration, max: Duration, streak: u64) -> Duration {
    if max.is_zero() || streak <= 1 {
        return base;
    }
    // saturating_mul keeps a pathological streak (u64::MAX) from
    // panicking on overflow; the clamp below does the real work.
    let doubled = base.saturating_mul(1u32 << (streak - 1).min(16) as u32);
    if doubled > max {
        max
    } else {
        doubled
    }
}

impl DbBroker {
    pub async fn new() -> anyhow::Result<Self> {
        let url =
            std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://./app.db?mode=rwc".into());
        let mut opts = sea_orm::ConnectOptions::new(url);
        opts.max_connections(8);
        let db = sea_orm::Database::connect(opts).await?;
        let db = Arc::new(db);
        Self::ensure_schema(db.as_ref()).await?;
        Ok(Self {
            db,
            poll_interval: Duration::from_secs(1),
            idle_poll_max: DEFAULT_IDLE_POLL_MAX,
            idle_streak: AtomicU64::new(0),
            wake: Arc::new(Notify::new()),
        })
    }

    /// Construct from an existing shared DB pool (PERF-004
    /// recommendation — the path the server bootstrap uses). Avoids
    /// opening a separate 8-connection pool just for the worker, and
    /// makes the queue live in the same DB the scheduler's
    /// `scheduled_job` / `job_run` rows live in.
    ///
    /// Uses the production poll/backoff defaults (1s base, 30s cap).
    pub async fn with_db(db: Arc<DatabaseConnection>) -> anyhow::Result<Self> {
        Self::with_db_opts(db, Duration::from_secs(1), DEFAULT_IDLE_POLL_MAX).await
    }

    /// [`with_db`] with explicit poll tuning — the variant the server
    /// bootstrap uses so `WORKER_POLL_INTERVAL_MS` /
    /// `WORKER_IDLE_POLL_MAX_MS` actually reach the broker (the
    /// hardcoded 1s previously ignored both).
    pub async fn with_db_opts(
        db: Arc<DatabaseConnection>,
        poll_interval: Duration,
        idle_poll_max: Duration,
    ) -> anyhow::Result<Self> {
        Self::ensure_schema(db.as_ref()).await?;
        Ok(Self {
            db,
            poll_interval,
            idle_poll_max,
            idle_streak: AtomicU64::new(0),
            wake: Arc::new(Notify::new()),
        })
    }

    async fn ensure_schema(db: &DatabaseConnection) -> anyhow::Result<()> {
        for stmt in [
            r#"CREATE TABLE IF NOT EXISTS jobs (
                id            TEXT PRIMARY KEY,
                job_type      TEXT NOT NULL,
                payload      TEXT NOT NULL,
                attempts      INTEGER NOT NULL DEFAULT 0,
                available_at  TIMESTAMP NOT NULL,
                created_at    TIMESTAMP NOT NULL
            )"#,
            r#"CREATE INDEX IF NOT EXISTS idx_jobs_available
                ON jobs (available_at)"#,
        ] {
            db.execute_unprepared(stmt).await?;
        }
        Ok(())
    }

    /// Wake up all workers sleeping on `self.wake` (PERF-005 fix).
    /// Called by `enqueue` after a job is inserted so workers don't
    /// wait up to `poll_interval` for the next poll.
    pub fn wake(&self) {
        self.wake.notify_waiters();
    }
}

#[async_trait]
impl WorkerBroker for DbBroker {
    async fn enqueue(&self, env: JobEnvelope) -> anyhow::Result<()> {
        let payload = serde_json::to_string(&env.payload)?;
        let now = Utc::now().naive_utc();
        let insert = Query::insert()
            .into_table(Jobs::Table)
            .columns([
                Jobs::Id,
                Jobs::JobType,
                Jobs::Payload,
                Jobs::Attempts,
                Jobs::AvailableAt,
                Jobs::CreatedAt,
            ])
            .values_panic([
                env.id.to_string().into(),
                env.job_type.into(),
                payload.into(),
                (env.attempts as i32).into(),
                now.into(),
                now.into(),
            ])
            .to_owned();
        let builder = self.db.get_database_backend();
        self.db.execute(builder.build(&insert)).await?;
        // PERF-005: wake any worker currently sleeping in `dequeue`'s
        // `tokio::select!` so it polls immediately instead of waiting
        // for `poll_interval` (1s by default).
        self.wake.notify_waiters();
        Ok(())
    }

    async fn dequeue(&self) -> anyhow::Result<Option<JobEnvelope>> {
        // PERF-003 fix: build the inner SELECT once and use it as the
        // DELETE's subquery.
        let backend = self.db.get_database_backend();
        let now = Utc::now().naive_utc();

        // Inner SELECT: oldest available job. No `FOR UPDATE SKIP
        // LOCKED` — that is Postgres-only syntax and this project links
        // ONLY the rust-sql engine; rustqlite serializes writes, so
        // concurrent workers cannot race on the same row.
        let select_oldest = SelectStatement::new()
            .column(Jobs::Id)
            .from(Jobs::Table)
            .and_where(Expr::col(Jobs::AvailableAt).lte(now))
            .order_by_columns([(Jobs::AvailableAt, sea_orm::sea_query::Order::Asc)])
            .limit(1)
            .to_owned();

        // DELETE ... WHERE id IN (the SELECT above) RETURNING *
        let delete = Query::delete()
            .from_table(Jobs::Table)
            .and_where(Expr::col(Jobs::Id).in_subquery(select_oldest))
            .returning_all()
            .to_owned();
        let stmt = backend.build(&delete);

        match self.db.query_one(stmt).await? {
            Some(row) => {
                // Queue has (or had) work: reset the idle streak so the
                // NEXT empty poll starts back at the base interval.
                self.idle_streak.store(0, Ordering::Relaxed);
                let id_str: String = row.try_get("", "id")?;
                let id = Uuid::parse_str(&id_str).unwrap_or_default();
                let job_type: String = row.try_get("", "job_type")?;
                let payload_str: String = row.try_get("", "payload")?;
                let payload: serde_json::Value = serde_json::from_str(&payload_str)?;
                let attempts: i32 = row.try_get("", "attempts")?;
                Ok(Some(JobEnvelope {
                    id,
                    job_type,
                    payload,
                    attempts: attempts as u32,
                    // Runtime-only: the runner swaps in the run's real
                    // token at dispatch time.
                    cancel: tokio_util::sync::CancellationToken::new(),
                }))
            }
            None => {
                // No job available — sleep the (exponentially backed-off)
                // idle interval OR until another `enqueue` calls
                // `notify_waiters`. The runner's outer loop already does
                // this select; this is the safety net for cases where the
                // runner's `select!` has already returned `Ready` (e.g. on
                // the first iteration when no Notify has fired yet).
                let streak = self.idle_streak.fetch_add(1, Ordering::Relaxed) + 1;
                let backoff = idle_backoff(self.poll_interval, self.idle_poll_max, streak);
                tokio::select! {
                    _ = self.wake.notified() => {}
                    _ = tokio::time::sleep(backoff) => {}
                }
                Ok(None)
            }
        }
    }

    async fn ack(&self, _env: &JobEnvelope) -> anyhow::Result<()> {
        // Row already deleted in `dequeue`.
        Ok(())
    }

    async fn nack(&self, env: &JobEnvelope, err: &str) -> anyhow::Result<()> {
        let mut env = env.clone();
        env.attempts += 1;
        tracing::warn!(job_id = %env.id, error = err, attempts = env.attempts, "nack re-enqueue");
        // `enqueue` already calls `notify_waiters` so the re-enqueued
        // job will be picked up immediately.
        self.enqueue(env).await
    }

    fn name(&self) -> &'static str {
        "db"
    }
}

#[derive(sea_orm::sea_query::Iden)]
enum Jobs {
    Table,
    Id,
    JobType,
    Payload,
    Attempts,
    AvailableAt,
    CreatedAt,
}

/// Default cap for the adaptive idle poll backoff (see [`DbBroker`]).
const DEFAULT_IDLE_POLL_MAX: Duration = Duration::from_secs(30);

#[cfg(test)]
mod tests {
    use super::*;

    /// The exponential idle-backoff curve — pure time-math, no clock.
    #[test]
    fn idle_backoff_doubles_then_saturates() {
        let base = Duration::from_secs(1);
        let max = Duration::from_secs(30);
        assert_eq!(idle_backoff(base, max, 0), base, "streak 0 is base");
        assert_eq!(idle_backoff(base, max, 1), base, "first empty poll is base");
        assert_eq!(idle_backoff(base, max, 2), Duration::from_secs(2));
        assert_eq!(idle_backoff(base, max, 3), Duration::from_secs(4));
        assert_eq!(idle_backoff(base, max, 5), Duration::from_secs(16));
        assert_eq!(
            idle_backoff(base, max, 6),
            Duration::from_secs(30),
            "clamped at max"
        );
        assert_eq!(
            idle_backoff(base, max, 40),
            Duration::from_secs(30),
            "stays at max"
        );
    }

    /// ZERO max disables the backoff entirely — the tight-polling shape
    /// tests and latency-sensitive deployments want.
    #[test]
    fn idle_backoff_zero_max_disables() {
        let base = Duration::from_millis(250);
        assert_eq!(idle_backoff(base, Duration::ZERO, 1), base);
        assert_eq!(idle_backoff(base, Duration::ZERO, 7), base);
        assert_eq!(idle_backoff(base, Duration::ZERO, u64::MAX), base);
    }

    /// A monstrous streak must saturate, not panic (saturating_mul +
    /// shift clamp keep the exponent bounded).
    #[test]
    fn idle_backoff_giant_streak_does_not_panic() {
        let base = Duration::from_secs(1);
        let max = Duration::from_secs(30);
        let d = idle_backoff(base, max, u64::MAX);
        assert!(d <= max);
    }
}
