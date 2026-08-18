use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::backend::WorkerBroker;
use super::registry::JobRegistry;

/// Maximum retry attempts before a job is considered poison and dropped.
const MAX_ATTEMPTS: u32 = 10;

/// Per-job timeout — prevents a hung handler from blocking a worker forever.
const JOB_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes

/// Runs `concurrency` consumer tasks against the configured broker.
/// Each task loops: `dequeue -> dispatch (with timeout) -> ack/nack (with backoff)`.
///
/// ## Fault tolerance
///
/// - **Max attempts**: a job that fails `MAX_ATTEMPTS` times (10) is acked
///   (removed from the queue) and logged as a poison message. No infinite retry.
/// - **Per-job timeout**: each handler runs inside a `tokio::time::timeout`
///   (5 min). If it exceeds the timeout, the job is nacked.
/// - **Panic isolation**: a panicking handler is caught via `catch_unwind`
///   (sub-task spawn). The job is nacked; the worker continues.
/// - **Exponential backoff on dequeue error**: starts at 500 ms, doubles up
///   to 60 s. Prevents CPU-spinning when the broker is down.
/// - **Graceful shutdown**: call `notify()` on the returned `Arc<Notify>`
///   to signal all workers to drain and exit after their current job.
pub struct WorkerRunner {
    broker: Arc<dyn WorkerBroker>,
    registry: Arc<JobRegistry>,
    concurrency: usize,
    shutdown: Arc<Notify>,
}

impl WorkerRunner {
    pub fn new(
        broker: Arc<dyn WorkerBroker>,
        registry: Arc<JobRegistry>,
        concurrency: usize,
    ) -> Self {
        Self {
            broker,
            registry,
            concurrency: concurrency.max(1),
            shutdown: Arc::new(Notify::new()),
        }
    }

    /// Returns a handle that can be used to signal graceful shutdown.
    pub fn shutdown_handle(&self) -> Arc<Notify> {
        self.shutdown.clone()
    }

    /// Spawn worker tasks. Returns a `JoinHandle` for the supervisor task
    /// that awaits all workers. Call `shutdown_handle().notify_waiters()`
    /// to gracefully stop all workers.
    pub fn spawn(self) -> JoinHandle<()> {
        let broker = self.broker;
        let registry = self.registry;
        let concurrency = self.concurrency;
        let shutdown = self.shutdown;

        tokio::spawn(async move {
            let mut handles = Vec::with_capacity(concurrency);
            for i in 0..concurrency {
                let b = broker.clone();
                let r = registry.clone();
                let s = shutdown.clone();
                handles.push(tokio::spawn(async move {
                    let mut backoff_ms: u64 = 500;
                    loop {
                        // Check for shutdown signal before each dequeue.
                        tokio::select! {
                            _ = s.notified() => {
                                tracing::info!(worker = i, "worker shutting down (graceful)");
                                break;
                            }
                            result = b.dequeue() => {
                                match result {
                                    Ok(Some(env)) => {
                                        // Reset backoff on successful dequeue.
                                        backoff_ms = 500;

                                        // Check max attempts — drop poison messages.
                                        if env.attempts >= MAX_ATTEMPTS {
                                            tracing::error!(
                                                job_id = %env.id,
                                                job_type = %env.job_type,
                                                attempts = env.attempts,
                                                "job exceeded max attempts — dropping (poison)"
                                            );
                                            let _ = b.ack(&env).await;
                                            continue;
                                        }

                                        let handler = match r.get(&env.job_type) {
                                            Some(h) => h,
                                            None => {
                                                tracing::warn!(job_type = %env.job_type, "no handler registered — dropping");
                                                let _ = b.ack(&env).await;
                                                continue;
                                            }
                                        };

                                        let env_for_panic = env.clone();
                                        let handler_for_panic = handler.clone();

                                        // Run handler with a timeout.
                                        let join = tokio::spawn(async move {
                                            handler_for_panic(env_for_panic).await
                                        });

                                        match tokio::time::timeout(JOB_TIMEOUT, join).await {
                                            Ok(Ok(Ok(()))) => {
                                                let _ = b.ack(&env).await;
                                            }
                                            Ok(Ok(Err(e))) => {
                                                tracing::warn!(
                                                    job_id = %env.id,
                                                    job_type = %env.job_type,
                                                    error = %e,
                                                    "job failed (attempt {}/{})",
                                                    env.attempts + 1,
                                                    MAX_ATTEMPTS
                                                );
                                                let _ = b.nack(&env, &e.to_string()).await;
                                            }
                                            Ok(Err(join_err)) => {
                                                let msg = if join_err.is_panic() {
                                                    let payload = join_err.into_panic();
                                                    if let Some(s) = payload.downcast_ref::<&'static str>() {
                                                        s.to_string()
                                                    } else if let Some(s) = payload.downcast_ref::<String>() {
                                                        s.clone()
                                                    } else {
                                                        "panic with unknown payload".to_string()
                                                    }
                                                } else {
                                                    "task cancelled".to_string()
                                                };
                                                tracing::error!(
                                                    job_id = %env.id,
                                                    job_type = %env.job_type,
                                                    panic = %msg,
                                                    "job handler panicked"
                                                );
                                                let _ = b.nack(&env, &msg).await;
                                            }
                                            Err(_) => {
                                                tracing::error!(
                                                    job_id = %env.id,
                                                    job_type = %env.job_type,
                                                    "job timed out after {}s — nacking",
                                                    JOB_TIMEOUT.as_secs()
                                                );
                                                let _ = b.nack(&env, "timeout").await;
                                            }
                                        }
                                    }
                                    Ok(None) => {
                                        // Broker signaled shutdown (e.g. Redis
                                        // returned None on BRPOP). Sleep and retry.
                                        tokio::select! {
                                            _ = s.notified() => break,
                                            _ = tokio::time::sleep(Duration::from_millis(backoff_ms)) => {}
                                        }
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            worker = i,
                                            error = %e,
                                            "dequeue failed — backing off {}ms",
                                            backoff_ms
                                        );
                                        // Exponential backoff: 500ms → 1s → 2s → ... → 60s max.
                                        tokio::select! {
                                            _ = s.notified() => break,
                                            _ = tokio::time::sleep(Duration::from_millis(backoff_ms)) => {}
                                        }
                                        backoff_ms = (backoff_ms * 2).min(60_000);
                                    }
                                }
                            }
                        }
                    }
                    tracing::info!(worker = i, "worker exited");
                }));
            }
            for h in handles {
                let _ = h.await;
            }
            tracing::info!("all workers stopped");
        })
    }
}
