//! The worker runner: `concurrency` consumer tasks, each looping
//! claim → run → settle.
//!
//! * **Lease renewal.** While a job runs, its lease is renewed every
//!   third of [`LEASE`]. A failed renewal means the job was cancelled
//!   (or, after a long stall, taken over) — the job's token fires.
//! * **Timeouts that stop the job.** On timeout the token fires; the job
//!   gets [`TIMEOUT_GRACE`] to wind down before its task is aborted, so a
//!   timed-out run never keeps going next to its retry.
//! * **Panics** count as failures; the worker carries on.
//! * **Settling.** Success deletes the row; a failure is retried after
//!   the policy's backoff, or moved to the dead set on the last attempt;
//!   an operator cancel just ends it; shutdown hands it back unchanged.
//!   Unknown kinds (a job removed from the catalog) go to the dead set
//!   instead of vanishing.
//! * **Idle polling** backs off exponentially (up to `idle_poll_max`)
//!   while the queue is empty; a local enqueue wakes workers at once.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::cancel::RunCancels;
use super::job::{JobContext, JobRegistry, RunObserver, RunOutcome};
use super::queue::{ts, ClaimedJob, JobQueue};

/// How long a claim holds a job without renewal. A crashed worker's
/// jobs become claimable again after this.
pub const LEASE: Duration = Duration::from_secs(60);

/// After a timeout, how long a job may take to notice its token before
/// its task is aborted.
pub const TIMEOUT_GRACE: Duration = Duration::from_secs(30);

pub struct WorkerRunner {
    queue: Arc<JobQueue>,
    registry: Arc<JobRegistry>,
    observer: Arc<dyn RunObserver>,
    cancels: Arc<RunCancels>,
    concurrency: usize,
    poll_interval: Duration,
    idle_poll_max: Duration,
    shutdown: CancellationToken,
    worker_id: String,
}

impl WorkerRunner {
    pub fn new(
        queue: Arc<JobQueue>,
        registry: Arc<JobRegistry>,
        observer: Arc<dyn RunObserver>,
        cancels: Arc<RunCancels>,
    ) -> Self {
        let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "host".into());
        Self {
            queue,
            registry,
            observer,
            cancels,
            concurrency: 4,
            poll_interval: Duration::from_secs(1),
            idle_poll_max: Duration::from_secs(30),
            shutdown: CancellationToken::new(),
            // Unique per process: leases are owned by exactly this runner.
            worker_id: format!(
                "{host}:{}:{}",
                std::process::id(),
                &uuid::Uuid::new_v4().simple().to_string()[..8]
            ),
        }
    }

    /// Consumer tasks (at least 1).
    pub fn concurrency(mut self, n: usize) -> Self {
        self.concurrency = n.max(1);
        self
    }

    /// Base poll interval and the cap of the idle backoff (`ZERO` = no
    /// backoff: always poll at the base interval).
    pub fn polling(mut self, interval: Duration, idle_max: Duration) -> Self {
        self.poll_interval = interval.max(Duration::from_millis(10));
        self.idle_poll_max = idle_max;
        self
    }

    /// Cancel to stop: workers finish settling, running jobs are
    /// interrupted (their tokens are children) and handed back.
    pub fn shutdown_handle(&self) -> CancellationToken {
        self.shutdown.clone()
    }

    /// Start the consumers; the handle resolves once all have stopped.
    pub fn spawn(self) -> JoinHandle<()> {
        let me = Arc::new(self);
        tokio::spawn(async move {
            let workers: Vec<_> = (0..me.concurrency)
                .map(|i| {
                    let me = me.clone();
                    tokio::spawn(async move { me.consume(i).await })
                })
                .collect();
            for w in workers {
                let _ = w.await;
            }
            tracing::info!("all workers stopped");
        })
    }

    async fn consume(&self, worker: usize) {
        let wake = self.queue.wake_signal();
        let mut idle_streak = 0u32;
        let mut error_backoff = Duration::from_millis(500);
        loop {
            if self.shutdown.is_cancelled() {
                break;
            }
            match self.queue.claim(&self.worker_id, LEASE).await {
                Ok(Some(job)) => {
                    idle_streak = 0;
                    error_backoff = Duration::from_millis(500);
                    self.run(job).await;
                }
                Ok(None) => {
                    idle_streak = idle_streak.saturating_add(1);
                    let wait = idle_wait(self.poll_interval, self.idle_poll_max, idle_streak);
                    tokio::select! {
                        _ = self.shutdown.cancelled() => break,
                        _ = wake.notified() => {}
                        _ = tokio::time::sleep(wait) => {}
                    }
                }
                Err(e) => {
                    tracing::warn!(worker, error = %e, "claiming a job failed — backing off");
                    tokio::select! {
                        _ = self.shutdown.cancelled() => break,
                        _ = tokio::time::sleep(error_backoff) => {}
                    }
                    error_backoff = (error_backoff * 2).min(Duration::from_secs(60));
                }
            }
        }
        tracing::info!(worker, "worker stopped");
    }

    /// Run one claimed job to its outcome and settle it.
    async fn run(&self, job: ClaimedJob) {
        let worker = self.worker_id.as_str();
        let Some(registered) = self.registry.get(&job.kind).cloned() else {
            let error = format!("no handler registered for job kind {:?}", job.kind);
            tracing::error!(job_id = %job.id, kind = %job.kind, "{error} — moved to the dead set");
            self.settle(&job, Settle::Bury(error)).await;
            return;
        };
        let policy = registered.policy;

        // Its lease expired after its final attempt (the worker died):
        // don't start an attempt the policy doesn't allow.
        if job.attempt > policy.max_attempts {
            let error = "the worker running the last attempt stopped responding".to_string();
            self.settle(&job, Settle::Bury(error)).await;
            return;
        }

        let cancel = self.cancels.register(job.id, &self.shutdown);
        let ctx = JobContext {
            id: job.id,
            attempt: job.attempt,
            max_attempts: policy.max_attempts,
            cancel: cancel.clone(),
            observer: self.observer.clone(),
        };
        self.observer.started(job.id, &job.kind, job.attempt).await;
        tracing::info!(job_id = %job.id, kind = %job.kind, attempt = job.attempt, "job started");

        let mut task = tokio::spawn((registered.handler)(ctx, job.args.clone()));
        let renew_every = LEASE / 3;
        let deadline = tokio::time::sleep(policy.timeout);
        tokio::pin!(deadline);
        let mut timed_out = false;
        let mut lease_lost = false;

        let result = loop {
            tokio::select! {
                joined = &mut task => break joined,
                _ = tokio::time::sleep(renew_every), if !lease_lost => {
                    match self.queue.renew(job.id, worker, LEASE).await {
                        Ok(true) => {}
                        // Cancelled by an operator (possibly on another
                        // instance) or taken over: stop the job.
                        Ok(false) => {
                            lease_lost = true;
                            cancel.cancel();
                        }
                        Err(e) => tracing::warn!(job_id = %job.id, error = %e, "lease renewal failed"),
                    }
                }
                _ = &mut deadline, if !timed_out => {
                    timed_out = true;
                    tracing::warn!(
                        job_id = %job.id, kind = %job.kind,
                        "job timed out after {}s — stopping it", policy.timeout.as_secs()
                    );
                    cancel.cancel();
                    // Give it the grace period, then abort.
                    match tokio::time::timeout(TIMEOUT_GRACE, &mut task).await {
                        Ok(joined) => break joined,
                        Err(_) => {
                            task.abort();
                            break (&mut task).await;
                        }
                    }
                }
            }
        };
        self.cancels.release(job.id);

        let outcome: Result<(), String> = match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(format!("{e:#}")),
            Err(join) if join.is_panic() => Err(format!("panicked: {}", panic_message(join))),
            Err(_) => Err("aborted".to_string()),
        };

        // A failure retries after the policy's backoff while attempts
        // remain, else the job goes to the dead set.
        let failed = |error: String| {
            if job.attempt < policy.max_attempts {
                let delay = policy.backoff.delay(job.attempt);
                let at = Utc::now()
                    + chrono::Duration::from_std(delay)
                        .unwrap_or_else(|_| chrono::Duration::hours(1));
                Settle::Retry { error, at }
            } else {
                Settle::Bury(error)
            }
        };
        let settle = if timed_out {
            failed(format!("timed out after {}s", policy.timeout.as_secs()))
        } else if self.shutdown.is_cancelled() && outcome.is_err() {
            Settle::Release
        } else if cancel.is_cancelled() && (outcome.is_err() || lease_lost) {
            // Operator cancel (here or on another instance): the job
            // stopped on purpose — never retried.
            Settle::Cancelled
        } else {
            match outcome {
                Ok(()) => Settle::Succeeded,
                Err(e) => failed(e),
            }
        };
        self.settle(&job, settle).await;
    }

    async fn settle(&self, job: &ClaimedJob, settle: Settle) {
        let worker = self.worker_id.as_str();
        let (result, outcome) = match settle {
            Settle::Succeeded => (
                self.queue.finish(job.id, worker).await,
                RunOutcome::Succeeded,
            ),
            Settle::Cancelled => (
                self.queue.finish(job.id, worker).await,
                RunOutcome::Cancelled,
            ),
            Settle::Release => (
                self.queue.release(job.id, worker).await,
                RunOutcome::Interrupted,
            ),
            Settle::Retry { error, at } => {
                tracing::warn!(job_id = %job.id, kind = %job.kind, attempt = job.attempt, %error, retry_at = %ts(at), "job failed — will retry");
                (
                    self.queue.retry(job.id, worker, at, &error).await,
                    RunOutcome::Retrying {
                        error,
                        retry_at: ts(at),
                    },
                )
            }
            Settle::Bury(error) => {
                tracing::error!(job_id = %job.id, kind = %job.kind, attempt = job.attempt, %error, "job failed for the last time — moved to the dead set");
                (
                    self.queue.bury(job.id, worker, &error).await,
                    RunOutcome::Failed { error },
                )
            }
        };
        if let Err(e) = result {
            // The lease will expire and the job be picked up again.
            tracing::error!(job_id = %job.id, error = %e, "could not record the job's outcome");
        }
        if outcome == RunOutcome::Succeeded {
            tracing::info!(job_id = %job.id, kind = %job.kind, "job succeeded");
        }
        self.observer.finished(job.id, &job.kind, &outcome).await;
    }
}

/// What to do with a job once its run is over.
enum Settle {
    Succeeded,
    Cancelled,
    Release,
    Retry {
        error: String,
        at: chrono::DateTime<Utc>,
    },
    Bury(String),
}

/// The n-th consecutive empty poll waits `base × 2^(n-1)`, capped at
/// `max` (`max == ZERO` turns the backoff off).
fn idle_wait(base: Duration, max: Duration, streak: u32) -> Duration {
    if max.is_zero() || streak <= 1 {
        return base;
    }
    base.saturating_mul(1u32 << (streak - 1).min(16))
        .min(max.max(base))
}

fn panic_message(join: tokio::task::JoinError) -> String {
    let payload = join.into_panic();
    if let Some(s) = payload.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::job::{Backoff, Job, JobPolicy};
    use crate::worker::queue::{tests::queue, EnqueueOptions, Enqueued};
    use async_trait::async_trait;
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicU32, Ordering};
    use uuid::Uuid;

    #[test]
    fn idle_wait_doubles_then_caps() {
        let s = Duration::from_secs(1);
        assert_eq!(idle_wait(s, Duration::from_secs(30), 1), s);
        assert_eq!(
            idle_wait(s, Duration::from_secs(30), 3),
            Duration::from_secs(4)
        );
        assert_eq!(
            idle_wait(s, Duration::from_secs(30), 99),
            Duration::from_secs(30)
        );
        assert_eq!(idle_wait(s, Duration::ZERO, 99), s);
    }

    /// Records every lifecycle event.
    #[derive(Default)]
    struct Recorder(Mutex<Vec<String>>);

    #[async_trait]
    impl RunObserver for Recorder {
        async fn started(&self, _: Uuid, kind: &str, attempt: u32) {
            self.0.lock().push(format!("start {kind} #{attempt}"));
        }
        async fn progressed(&self, _: Uuid, detail: &serde_json::Value) {
            self.0.lock().push(format!("progress {detail}"));
        }
        async fn finished(&self, _: Uuid, kind: &str, outcome: &RunOutcome) {
            let what = match outcome {
                RunOutcome::Succeeded => "succeeded",
                RunOutcome::Retrying { .. } => "retrying",
                RunOutcome::Failed { .. } => "failed",
                RunOutcome::Cancelled => "cancelled",
                RunOutcome::Interrupted => "interrupted",
            };
            self.0.lock().push(format!("{what} {kind}"));
        }
    }

    impl Recorder {
        fn events(&self) -> Vec<String> {
            self.0.lock().clone()
        }
        async fn wait_for(&self, event: &str) {
            for _ in 0..200 {
                if self.events().iter().any(|e| e == event) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            panic!("never saw {event:?}; got {:?}", self.events());
        }
    }

    /// Fails until attempt `succeed_on`, reporting progress.
    struct Flaky {
        succeed_on: u32,
        runs: Arc<AtomicU32>,
    }

    #[async_trait]
    impl Job for Flaky {
        const KIND: &'static str = "test.flaky";
        type Args = ();
        fn policy(&self) -> JobPolicy {
            JobPolicy {
                timeout: Duration::from_secs(5),
                max_attempts: 3,
                backoff: Backoff {
                    base: Duration::from_millis(1),
                    cap: Duration::from_millis(1),
                },
            }
        }
        async fn perform(&self, ctx: &JobContext, _: ()) -> anyhow::Result<()> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            ctx.progress(serde_json::json!(ctx.attempt)).await;
            anyhow::ensure!(ctx.attempt >= self.succeed_on, "not yet");
            Ok(())
        }
    }

    /// Waits for cancellation, or for `run_for`.
    struct Sleepy {
        run_for: Duration,
        timeout: Duration,
    }

    #[async_trait]
    impl Job for Sleepy {
        const KIND: &'static str = "test.sleepy";
        type Args = ();
        fn policy(&self) -> JobPolicy {
            JobPolicy {
                timeout: self.timeout,
                max_attempts: 1,
                backoff: Backoff::default(),
            }
        }
        async fn perform(&self, ctx: &JobContext, _: ()) -> anyhow::Result<()> {
            tokio::select! {
                _ = tokio::time::sleep(self.run_for) => Ok(()),
                _ = ctx.cancel.cancelled() => anyhow::bail!("stopped"),
            }
        }
    }

    async fn start(
        registry: JobRegistry,
    ) -> (
        Arc<JobQueue>,
        Arc<Recorder>,
        Arc<RunCancels>,
        CancellationToken,
    ) {
        let queue = Arc::new(queue().await);
        let recorder = Arc::new(Recorder::default());
        let cancels = Arc::new(RunCancels::new());
        let runner = WorkerRunner::new(
            queue.clone(),
            Arc::new(registry),
            recorder.clone(),
            cancels.clone(),
        )
        .concurrency(2)
        .polling(Duration::from_millis(20), Duration::ZERO);
        let shutdown = runner.shutdown_handle();
        runner.spawn();
        (queue, recorder, cancels, shutdown)
    }

    #[tokio::test]
    async fn failures_retry_with_backoff_until_success() {
        let runs = Arc::new(AtomicU32::new(0));
        let mut registry = JobRegistry::new();
        registry.add(Flaky {
            succeed_on: 3,
            runs: runs.clone(),
        });
        let (queue, recorder, _, shutdown) = start(registry).await;

        let Enqueued::Inserted(id) = queue
            .enqueue::<Flaky>(&(), EnqueueOptions::default())
            .await
            .unwrap()
        else {
            panic!()
        };
        recorder.wait_for("succeeded test.flaky").await;
        assert_eq!(runs.load(Ordering::SeqCst), 3);
        let events = recorder.events();
        assert_eq!(
            events
                .iter()
                .filter(|e| *e == "retrying test.flaky")
                .count(),
            2
        );
        assert!(events.contains(&"progress 3".to_string()));
        assert!(
            queue.get(id).await.unwrap().is_none(),
            "a finished job leaves the queue"
        );
        shutdown.cancel();
    }

    #[tokio::test]
    async fn the_last_failure_lands_in_the_dead_set() {
        let mut registry = JobRegistry::new();
        registry.add(Flaky {
            succeed_on: 99,
            runs: Arc::new(AtomicU32::new(0)),
        });
        let (queue, recorder, _, shutdown) = start(registry).await;
        queue
            .enqueue::<Flaky>(&(), EnqueueOptions::default())
            .await
            .unwrap();
        recorder.wait_for("failed test.flaky").await;
        let dead = queue.dead_jobs(5).await.unwrap();
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0].attempt, 3);
        assert!(dead[0].last_error.as_deref().unwrap().contains("not yet"));
        shutdown.cancel();
    }

    #[tokio::test]
    async fn unknown_kinds_are_kept_dead_not_dropped() {
        let (queue, recorder, _, shutdown) = start(JobRegistry::new()).await;
        queue
            .enqueue_raw("gone.job", serde_json::json!({}), EnqueueOptions::default())
            .await
            .unwrap();
        recorder.wait_for("failed gone.job").await;
        let dead = queue.dead_jobs(5).await.unwrap();
        assert!(dead[0]
            .last_error
            .as_deref()
            .unwrap()
            .contains("no handler"));
        shutdown.cancel();
    }

    #[tokio::test]
    async fn a_timeout_stops_the_job() {
        let mut registry = JobRegistry::new();
        registry.add(Sleepy {
            run_for: Duration::from_secs(60),
            timeout: Duration::from_millis(100),
        });
        let (queue, recorder, _, shutdown) = start(registry).await;
        queue
            .enqueue::<Sleepy>(&(), EnqueueOptions::default())
            .await
            .unwrap();
        recorder.wait_for("failed test.sleepy").await;
        let dead = queue.dead_jobs(5).await.unwrap();
        assert!(dead[0].last_error.as_deref().unwrap().contains("timed out"));
        shutdown.cancel();
    }

    #[tokio::test]
    async fn cancelling_stops_a_running_job_without_retry() {
        let mut registry = JobRegistry::new();
        registry.add(Sleepy {
            run_for: Duration::from_secs(60),
            timeout: Duration::from_secs(60),
        });
        let (queue, recorder, cancels, shutdown) = start(registry).await;
        let Enqueued::Inserted(id) = queue
            .enqueue::<Sleepy>(&(), EnqueueOptions::default())
            .await
            .unwrap()
        else {
            panic!()
        };
        recorder.wait_for("start test.sleepy #1").await;
        assert!(queue.cancel(id).await.unwrap());
        cancels.cancel(id);
        recorder.wait_for("cancelled test.sleepy").await;
        assert!(queue.get(id).await.unwrap().is_none());
        shutdown.cancel();
    }

    #[tokio::test]
    async fn shutdown_hands_running_jobs_back() {
        let mut registry = JobRegistry::new();
        registry.add(Sleepy {
            run_for: Duration::from_secs(60),
            timeout: Duration::from_secs(60),
        });
        let (queue, recorder, _, shutdown) = start(registry).await;
        let Enqueued::Inserted(id) = queue
            .enqueue::<Sleepy>(&(), EnqueueOptions::default())
            .await
            .unwrap()
        else {
            panic!()
        };
        recorder.wait_for("start test.sleepy #1").await;
        shutdown.cancel();
        recorder.wait_for("interrupted test.sleepy").await;
        // Back in the queue, attempt not spent.
        let again = queue.claim("next-process", LEASE).await.unwrap().unwrap();
        assert_eq!((again.id, again.attempt), (id, 1));
    }
}
