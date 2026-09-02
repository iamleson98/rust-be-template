use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::backend::WorkerBroker;
use super::cancel::RunCancels;
use super::registry::JobRegistry;

/// Runs `concurrency` consumer tasks against the configured broker.
/// Each task loops: `dequeue -> dispatch (with timeout) -> ack/nack (with backoff)`.
///
/// ## Fault tolerance
///
/// - **Per-job policy**: timeout and max attempts come from the
///   [`JobRegistry`](super::registry::JobRegistry) policy registered for
///   the job type (default: 5-minute timeout, 10 attempts). Long-running
///   jobs like the OSM import register their own policy.
/// - **Per-job timeout**: each handler runs inside a `tokio::time::timeout`.
///   If it exceeds the timeout, the job is nacked. NOTE: dropping the
///   future does not stop a `spawn_blocking` body — long jobs must be
///   internally idempotent / single-flighted.
/// - **Panic isolation**: a panicking handler is caught via `catch_unwind`
///   (sub-task spawn). The job is nacked; the worker continues.
/// - **Exponential backoff on dequeue error**: starts at 500 ms, doubles up
///   to 60 s. Prevents CPU-spinning when the broker is down.
/// - **Graceful shutdown**: cancel the token from
///   [`shutdown_handle`](Self::shutdown_handle) (the runner's own token —
///   also linked to [`crate::worker::notify_shutdown`]) to signal all
///   workers to drain and exit after their current job. In-flight job
///   handlers observe it through `JobEnvelope::cancel` and stop
///   cooperatively.
/// - **Run cancellation**: each dispatched run's token is registered in
///   the shared [`RunCancels`] so `JobService::cancel` (the admin kill
///   button) can cancel it; a cancelled run is always acked (never
///   retried) — cancellation is intentional, not a failure.
pub struct WorkerRunner {
    broker: Arc<dyn WorkerBroker>,
    registry: Arc<JobRegistry>,
    concurrency: usize,
    shutdown: CancellationToken,
    cancels: Arc<RunCancels>,
}

impl WorkerRunner {
    pub fn new(
        broker: Arc<dyn WorkerBroker>,
        registry: Arc<JobRegistry>,
        concurrency: usize,
        cancels: Arc<RunCancels>,
    ) -> Self {
        Self {
            broker,
            registry,
            concurrency: concurrency.max(1),
            shutdown: CancellationToken::new(),
            cancels,
        }
    }

    /// Returns a handle that can be used to signal graceful shutdown.
    /// Cancelling it stops the worker loops AND every in-flight job
    /// handler (each run's token is a child of this one).
    pub fn shutdown_handle(&self) -> CancellationToken {
        self.shutdown.clone()
    }

    /// Spawn worker tasks. Returns a `JoinHandle` for the supervisor task
    /// that awaits all workers — `server::run`'s graceful-shutdown future
    /// awaits it (bounded) so a multi-hour import can't wedge the
    /// process. Cancel `shutdown_handle()` to stop all workers.
    pub fn spawn(self) -> JoinHandle<()> {
        let broker = self.broker;
        let registry = self.registry;
        let concurrency = self.concurrency;
        let shutdown = self.shutdown;
        let cancels = self.cancels;

        tokio::spawn(async move {
            let mut handles = Vec::with_capacity(concurrency);
            for i in 0..concurrency {
                let b = broker.clone();
                let r = registry.clone();
                let s = shutdown.clone();
                let c = cancels.clone();
                handles.push(tokio::spawn(async move {
                    let mut backoff_ms: u64 = 500;
                    loop {
                        // Check for shutdown signal before each dequeue.
                        tokio::select! {
                            _ = s.cancelled() => {
                                tracing::info!(worker = i, "worker shutting down (graceful)");
                                break;
                            }
                            result = b.dequeue() => {
                                match result {
                                    Ok(Some(env)) => {
                                        // Reset backoff on successful dequeue.
                                        backoff_ms = 500;

                                        // Check max attempts — drop poison messages.
                                        // The policy comes from the registry so
                                        // long-running jobs can opt out of the
                                        // 10-attempt default.
                                        let policy = r.policy(&env.job_type);
                                        if env.attempts >= policy.max_attempts {
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

                                        // Link the run into the cancellation
                                        // registry: the token is a child of the
                                        // shutdown token (Ctrl+C cancels it) and
                                        // is registered so the admin kill button
                                        // (`JobService::cancel`) can cancel it.
                                        let run_id = env.run_id();
                                        let mut env = env;
                                        if let Some(run_id) = run_id {
                                            env.cancel = c.register(run_id, &s);
                                        }

                                        let env_for_panic = env.clone();
                                        let handler_for_panic = handler.clone();

                                        // Run handler with the job's policy timeout.
                                        let join = tokio::spawn(async move {
                                            handler_for_panic(env_for_panic).await
                                        });

                                        match tokio::time::timeout(policy.timeout, join).await {
                                            Ok(Ok(Ok(()))) => {
                                                let _ = b.ack(&env).await;
                                            }
                                            Ok(Ok(Err(e))) => {
                                                // A cancelled run is a SUCCESSFUL
                                                // stop, not a failure: ack (no
                                                // retry) so the operator's kill
                                                // isn't undone by the retry loop.
                                                if env.cancel.is_cancelled() {
                                                    tracing::info!(
                                                        job_id = %env.id,
                                                        job_type = %env.job_type,
                                                        error = %e,
                                                        "job cancelled — acking (no retry)"
                                                    );
                                                    let _ = b.ack(&env).await;
                                                } else {
                                                    tracing::warn!(
                                                        job_id = %env.id,
                                                        job_type = %env.job_type,
                                                        error = %e,
                                                        "job failed (attempt {}/{})",
                                                        env.attempts + 1,
                                                        policy.max_attempts
                                                    );
                                                    let _ = b.nack(&env, &e.to_string()).await;
                                                }
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
                                                    policy.timeout.as_secs()
                                                );
                                                let _ = b.nack(&env, "timeout").await;
                                            }
                                        }

                                        // Forget the run on every exit path —
                                        // including timeout and panic.
                                        if let Some(run_id) = run_id {
                                            c.release(run_id);
                                        }
                                    }
                                    Ok(None) => {
                                        // Broker signaled shutdown (e.g. Redis
                                        // returned None on BRPOP). Sleep and retry.
                                        tokio::select! {
                                            _ = s.cancelled() => break,
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
                                            _ = s.cancelled() => break,
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
