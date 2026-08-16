use std::sync::Arc;

use tokio::task::JoinHandle;

use super::backend::WorkerBroker;
use super::registry::JobRegistry;

/// Runs `concurrency` consumer tasks against the configured broker.
/// Each task loops: `dequeue -> dispatch -> ack/nack`.
///
/// ## Backpressure
///
/// Each worker task processes exactly one job at a time. If `dispatch`
/// is slow, the worker doesn't dequeue the next job until the current
/// one finishes. This naturally applies backpressure: the broker's queue
/// grows but workers never get overwhelmed.
///
/// ## Failure isolation
///
/// A panic in a job handler is caught via `catch_unwind` and doesn't kill
/// the worker. The job is `nack`'d (re-enqueued with incremented
/// `attempts`) and the worker continues.
pub struct WorkerRunner {
    broker: Arc<dyn WorkerBroker>,
    registry: Arc<JobRegistry>,
    concurrency: usize,
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
            concurrency,
        }
    }

    /// Spawn worker tasks. Returns a `JoinHandle` for the supervisor task
    /// that awaits all workers.
    pub fn spawn(self) -> JoinHandle<()> {
        let broker = self.broker;
        let registry = self.registry;
        let concurrency = self.concurrency;

        tokio::spawn(async move {
            let mut handles = Vec::with_capacity(concurrency);
            for i in 0..concurrency {
                let b = broker.clone();
                let r = registry.clone();
                handles.push(tokio::spawn(async move {
                    loop {
                        match b.dequeue().await {
                            Ok(Some(env)) => {
                                let handler = match r.get(&env.job_type) {
                                    Some(h) => h,
                                    None => {
                                        tracing::warn!(job_type = %env.job_type, "no handler");
                                        let _ = b.ack(&env).await;
                                        continue;
                                    }
                                };
                                // Dispatch with catch-all so a panicking
                                // handler doesn't kill the worker. We
                                // spawn a sub-task and check if it panicked.
                                let env_for_panic = env.clone();
                                let handler_for_panic = handler.clone();
                                let join = tokio::spawn(async move {
                                    handler_for_panic(env_for_panic).await
                                });
                                match join.await {
                                    Ok(Ok(())) => {
                                        let _ = b.ack(&env).await;
                                    }
                                    Ok(Err(e)) => {
                                        tracing::warn!(job_id = %env.id, error = %e, "job failed");
                                        let _ = b.nack(&env, &e.to_string()).await;
                                    }
                                    Err(join_err) => {
                                        let msg = if join_err.is_panic() {
                                            // Recover the panic payload.
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
                                            panic = %msg,
                                            "job handler panicked"
                                        );
                                        let _ = b.nack(&env, &msg).await;
                                    }
                                }
                            }
                            Ok(None) => break,
                            Err(e) => {
                                tracing::warn!(worker = i, error = %e, "dequeue failed");
                                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            }
                        }
                    }
                }));
            }
            for h in handles {
                let _ = h.await;
            }
        })
    }
}

