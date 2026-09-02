//! Pluggable async worker broker. Trait + three backends:
//! - `RedisBroker`: BLPOP/BRPOP, sub-ms latency, simplest to scale out
//! - `DbBroker`: Postgres `FOR UPDATE SKIP LOCKED` — zero new infra
//!   (default: works on the SQLite/Postgres DB the app already runs on)
//! - `KafkaBroker`: rdkafka producer/consumer — high-throughput at scale
//!
//! The [`runner`] consumes jobs from whichever broker is selected and
//! dispatches them to registered handlers. [`build_shared`] is the
//! variant the server bootstrap uses (DB broker shares the app's pool).

pub use self::backend::{JobEnvelope, WorkerBroker};
pub use self::cancel::RunCancels;
pub use self::db::DbBroker;
pub use self::kafka::KafkaBroker;
pub use self::redis::RedisBroker;
pub use self::registry::{JobHandler, JobPolicy, JobRegistry, JobType};
pub use self::runner::WorkerRunner;

mod backend;
mod cancel;
mod db;
mod kafka;
mod redis;
mod registry;
mod runner;

use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use sea_orm::DatabaseConnection;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::config::{WorkerBackend as WorkerBackendCfg, WorkerConfig};

/// Construct the configured broker (opens its own DB pool for the `db`
/// backend — prefer [`build_shared`] when a pool already exists).
pub async fn build(cfg: &WorkerConfig) -> anyhow::Result<Box<dyn WorkerBroker>> {
    match cfg.backend {
        WorkerBackendCfg::Redis => Ok(Box::new(RedisBroker::connect(cfg).await?)),
        WorkerBackendCfg::Db => Ok(Box::new(DbBroker::new().await?)),
        WorkerBackendCfg::Kafka => Ok(Box::new(KafkaBroker::new(cfg).await?)),
    }
}

/// Like [`build`], but the `db` backend reuses the application's shared
/// connection pool instead of opening a second one. Redis/Kafka
/// backends fall through to [`build`] (they have no pool to share).
pub async fn build_shared(
    cfg: &WorkerConfig,
    db: Arc<DatabaseConnection>,
) -> anyhow::Result<Arc<dyn WorkerBroker>> {
    match cfg.backend {
        WorkerBackendCfg::Db => Ok(Arc::new(DbBroker::with_db(db).await?)),
        _ => Ok(Arc::from(build(cfg).await?)),
    }
}

// ── Process-global shutdown signal ──────────────────────────────
//
// The runner is spawned deep inside `server::bootstrap`, but the
// graceful-shutdown future lives in `server::run`. Rather than thread
// the token through `AppState` (it is not request-scoped state), the
// bootstrap stores it here once — the same "in-process singleton"
// pattern the WebSocket hubs use.

/// Handle set by [`set_shutdown_handle`] at bootstrap.
static SHUTDOWN: OnceLock<CancellationToken> = OnceLock::new();

/// The worker-runner supervisor handle set by [`set_supervisor`] at
/// bootstrap. `server::run`'s shutdown future awaits it (bounded) so the
/// process never exits while a worker is mid-drain — and force-exits if
/// one refuses to stop (an orphaned `spawn_blocking` body).
static SUPERVISOR: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();

/// Remember the runner's shutdown token so `server::run`'s
/// graceful-shutdown future can signal workers to drain. Cancelling it
/// also cancels every in-flight job handler (their tokens are children).
pub fn set_shutdown_handle(handle: CancellationToken) {
    let _ = SHUTDOWN.set(handle);
}

/// The process-wide worker shutdown token (a fresh, never-cancelled one
/// when no runner was started, e.g. `SCHEDULER_ENABLED=false`).
pub fn shutdown_token() -> CancellationToken {
    SHUTDOWN.get_or_init(CancellationToken::new).clone()
}

/// Signal all worker tasks to exit after their current job and cancel
/// in-flight job handlers. No-op when no worker was ever started
/// (e.g. `SCHEDULER_ENABLED=false`).
pub fn notify_shutdown() {
    shutdown_token().cancel();
}

/// Stash the runner supervisor's `JoinHandle` (awaited during shutdown).
pub fn set_supervisor(handle: JoinHandle<()>) {
    if let Ok(mut slot) = SUPERVISOR.get_or_init(|| Mutex::new(None)).lock() {
        slot.replace(handle);
    }
}

/// Wait (at most `timeout`) for the worker supervisor to finish after
/// [`notify_shutdown`]. Returns `true` when all workers stopped (or none
/// were ever started); `false` on timeout — the caller should then
/// force-exit, because an orphaned `spawn_blocking` job body would
/// otherwise block the tokio runtime's drop indefinitely (the runtime
/// waits for blocking tasks on `main`'s return).
pub async fn await_worker_shutdown(timeout: Duration) -> bool {
    let handle = SUPERVISOR
        .get()
        .and_then(|m| m.lock().ok().and_then(|mut g| g.take()));
    match handle {
        // No runner started in this process — nothing to wait for.
        None => true,
        Some(handle) => match tokio::time::timeout(timeout, handle).await {
            Ok(_) => true,
            Err(_) => false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::registry::JobRegistry;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    /// End-to-end: enqueue → runner consumes → handler runs → ack.
    /// Proves the whole wiring that `server::bootstrap` now uses
    /// (shared-pool DbBroker + registry + runner) actually executes jobs.
    #[tokio::test]
    async fn runner_executes_an_enqueued_job_end_to_end() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let db = Arc::new(db);
        let broker: Arc<dyn WorkerBroker> = Arc::new(DbBroker::with_db(db).await.unwrap());

        let done = Arc::new(AtomicBool::new(false));
        let registry = Arc::new(JobRegistry::new());
        {
            let done = done.clone();
            registry.register("test.noop", move |env: JobEnvelope| {
                let done = done.clone();
                async move {
                    assert_eq!(env.job_type, "test.noop");
                    done.store(true, Ordering::SeqCst);
                    Ok(())
                }
            });
        }

        let runner = WorkerRunner::new(broker.clone(), registry, 1, Arc::new(RunCancels::new()));
        let shutdown = runner.shutdown_handle();
        runner.spawn();

        broker
            .enqueue(JobEnvelope::new("test.noop", &serde_json::json!({})).unwrap())
            .await
            .unwrap();

        // Wait for the worker to pick it up (dequeue polls at ~1s).
        for _ in 0..100 {
            if done.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(done.load(Ordering::SeqCst), "job did not run");

        shutdown.cancel();
    }

    /// Nack path: a failing handler is re-enqueued with attempts+1,
    /// and the poison-drop threshold comes from the registered policy.
    #[tokio::test]
    async fn failing_job_is_retried_then_dropped_per_policy() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let db = Arc::new(db);
        let broker: Arc<dyn WorkerBroker> = Arc::new(DbBroker::with_db(db).await.unwrap());

        let attempts_seen = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let registry = Arc::new(JobRegistry::new());
        {
            let attempts_seen = attempts_seen.clone();
            registry.register_with_policy(
                "test.flaky",
                move |_env: JobEnvelope| {
                    let attempts_seen = attempts_seen.clone();
                    async move {
                        attempts_seen.fetch_add(1, Ordering::SeqCst);
                        Err(anyhow::anyhow!("always fails"))
                    }
                },
                JobPolicy {
                    timeout: std::time::Duration::from_secs(5),
                    max_attempts: 2,
                },
            );
        }

        let runner = WorkerRunner::new(broker.clone(), registry, 1, Arc::new(RunCancels::new()));
        let shutdown = runner.shutdown_handle();
        runner.spawn();

        broker
            .enqueue(JobEnvelope::new("test.flaky", &serde_json::json!({})).unwrap())
            .await
            .unwrap();

        // Initial run + 1 retry, then the poison check drops it.
        for _ in 0..150 {
            if attempts_seen.load(Ordering::SeqCst) >= 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert_eq!(
            attempts_seen.load(Ordering::SeqCst),
            2,
            "expected exactly max_attempts executions"
        );
        shutdown.cancel();
    }

    /// Cancellation path: `RunCancels::cancel` stops an in-flight handler
    /// that awaits its envelope token, and the runner ACKs the job (no
    /// retry) because the cancellation was intentional.
    #[tokio::test]
    async fn cancelled_job_is_stopped_and_acked_not_retried() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let db = Arc::new(db);
        let broker: Arc<dyn WorkerBroker> = Arc::new(DbBroker::with_db(db).await.unwrap());

        let started = Arc::new(AtomicBool::new(false));
        let cancelled_seen = Arc::new(AtomicBool::new(false));
        let attempts = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let registry = Arc::new(JobRegistry::new());
        {
            let started = started.clone();
            let cancelled_seen = cancelled_seen.clone();
            let attempts = attempts.clone();
            registry.register_with_policy(
                "test.long",
                move |env: JobEnvelope| {
                    let started = started.clone();
                    let cancelled_seen = cancelled_seen.clone();
                    let attempts = attempts.clone();
                    async move {
                        attempts.fetch_add(1, Ordering::SeqCst);
                        started.store(true, Ordering::SeqCst);
                        // Cooperative handler: wait for either completion
                        // or cancellation — the pattern real jobs follow.
                        tokio::select! {
                            _ = tokio::time::sleep(Duration::from_millis(10_000)) => Ok(()),
                            _ = env.cancel.cancelled() => {
                                cancelled_seen.store(true, Ordering::SeqCst);
                                Err(anyhow::anyhow!("cancelled"))
                            }
                        }
                    }
                },
                JobPolicy {
                    timeout: Duration::from_secs(30),
                    max_attempts: 5,
                },
            );
        }

        let cancels = Arc::new(RunCancels::new());
        let runner = WorkerRunner::new(broker.clone(), registry, 1, cancels.clone());
        let shutdown = runner.shutdown_handle();
        runner.spawn();

        // RunPayload shape so the runner links the envelope to a run id.
        let run_id = uuid::Uuid::new_v4();
        broker
            .enqueue(
                JobEnvelope::new("test.long", &serde_json::json!({ "run_id": run_id })).unwrap(),
            )
            .await
            .unwrap();

        // Wait until dispatched, then kill it from the "admin" side.
        for _ in 0..100 {
            if started.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(started.load(Ordering::SeqCst), "job did not start");
        cancels.cancel(run_id);

        for _ in 0..100 {
            if cancelled_seen.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(
            cancelled_seen.load(Ordering::SeqCst),
            "handler never observed the cancellation"
        );

        // The runner acked (no retry): give the ack a moment, then assert
        // exactly ONE execution happened.
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            1,
            "a cancelled run must not be retried"
        );
        assert!(!cancels.is_live(run_id), "run must be released");

        shutdown.cancel();
    }
}
