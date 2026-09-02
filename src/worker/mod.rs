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
pub use self::db::DbBroker;
pub use self::kafka::KafkaBroker;
pub use self::redis::RedisBroker;
pub use self::registry::{JobHandler, JobPolicy, JobRegistry, JobType};
pub use self::runner::WorkerRunner;

mod backend;
mod db;
mod kafka;
mod redis;
mod registry;
mod runner;

use std::sync::{Arc, OnceLock};

use sea_orm::DatabaseConnection;
use tokio::sync::Notify;

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
// the `Arc<Notify>` through `AppState` (it is not request-scoped
// state), the bootstrap stores it here once — the same
// "in-process singleton" pattern the WebSocket hubs use.

/// Handle set by [`set_shutdown_handle`] at bootstrap.
static SHUTDOWN: OnceLock<Arc<Notify>> = OnceLock::new();

/// Remember the runner's shutdown handle so `server::run`'s
/// graceful-shutdown future can signal workers to drain.
pub fn set_shutdown_handle(handle: Arc<Notify>) {
    let _ = SHUTDOWN.set(handle);
}

/// Notify all worker tasks to exit after their current job. No-op when
/// no worker was ever started (e.g. `SCHEDULER_ENABLED=false`).
pub fn notify_shutdown() {
    if let Some(h) = SHUTDOWN.get() {
        // `notify_waiters` wakes every waiting consumer; tasks mid-job
        // see it on their next loop iteration.
        h.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::registry::JobRegistry;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// End-to-end: enqueue → runner consumes → handler runs → ack.
    /// Proves the whole wiring that `server::bootstrap` now uses
    /// (shared-pool DbBroker + registry + runner) actually executes jobs.
    #[tokio::test]
    async fn runner_executes_an_enqueued_job_end_to_end() {
        let db = sea_orm::Database::connect("sqlite::memory:")
            .await
            .unwrap();
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

        let runner = WorkerRunner::new(broker.clone(), registry, 1);
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

        shutdown.notify_waiters();
    }

    /// Nack path: a failing handler is re-enqueued with attempts+1,
    /// and the poison-drop threshold comes from the registered policy.
    #[tokio::test]
    async fn failing_job_is_retried_then_dropped_per_policy() {
        let db = sea_orm::Database::connect("sqlite::memory:")
            .await
            .unwrap();
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

        let runner = WorkerRunner::new(broker.clone(), registry, 1);
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
        shutdown.notify_waiters();
    }
}
