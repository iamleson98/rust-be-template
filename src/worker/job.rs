//! What a background job is: a [`Job`] implementation, the
//! [`JobPolicy`] the runner applies to it, the [`JobContext`] it runs
//! with, and the [`JobRegistry`] that maps kinds to jobs.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rand::Rng;
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// A kind of background work.
///
/// ```ignore
/// struct SendReceipt { mailer: Arc<Mailer> }
///
/// #[async_trait]
/// impl Job for SendReceipt {
///     const KIND: &'static str = "booking.send_receipt";
///     type Args = ReceiptArgs; // Serialize + Deserialize
///
///     async fn perform(&self, ctx: &JobContext, args: ReceiptArgs) -> anyhow::Result<()> {
///         self.mailer.send(args.booking_id).await
///     }
/// }
/// ```
///
/// Delivery is at-least-once: a job whose worker crashed mid-run runs
/// again once its lease expires, so `perform` must be safe to repeat
/// (upserts, idempotency keys on outbound calls).
#[async_trait]
pub trait Job: Send + Sync + 'static {
    /// Stable identity on the queue, in run history and on the admin
    /// page (`<domain>.<verb>`, e.g. `osm.import`). Never rename a kind
    /// that may still have rows queued.
    const KIND: &'static str;

    /// What one run needs to know, stored as JSON on the queue row.
    type Args: Serialize + DeserializeOwned + Send + 'static;

    /// Timeout, attempts and retry backoff for this kind.
    fn policy(&self) -> JobPolicy {
        JobPolicy::default()
    }

    /// Do the work. Return `Err` to have the runner retry (with backoff)
    /// until the policy's attempts run out. Long jobs should watch
    /// `ctx.cancel`: it fires when an operator cancels the run, when the
    /// timeout hits, and on shutdown.
    async fn perform(&self, ctx: &JobContext, args: Self::Args) -> anyhow::Result<()>;
}

/// How the runner treats one job kind.
#[derive(Debug, Clone)]
pub struct JobPolicy {
    /// Stop the job after this long: its cancellation token fires, and
    /// the attempt counts as failed.
    pub timeout: Duration,
    /// Total runs before the job is moved to the dead set. The first run
    /// counts as attempt 1.
    pub max_attempts: u32,
    /// Wait before the next attempt.
    pub backoff: Backoff,
}

impl Default for JobPolicy {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(300),
            max_attempts: 5,
            backoff: Backoff::default(),
        }
    }
}

/// Exponential backoff with jitter between attempts: after failed
/// attempt `n`, wait somewhere in `[d/2, d]` where `d = min(cap, base ×
/// 2^(n-1))` ("equal jitter" — retries of jobs that failed together
/// spread out, and a retry never fires immediately).
#[derive(Debug, Clone, Copy)]
pub struct Backoff {
    pub base: Duration,
    pub cap: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Self {
            base: Duration::from_secs(15),
            cap: Duration::from_secs(3600),
        }
    }
}

impl Backoff {
    /// The full delay window after `attempt` (1-based) failed.
    pub fn ceiling(&self, attempt: u32) -> Duration {
        let exp = attempt.saturating_sub(1).min(20);
        self.base.saturating_mul(1u32 << exp).min(self.cap)
    }

    /// A random delay in `[ceiling/2, ceiling]`.
    pub fn delay(&self, attempt: u32) -> Duration {
        let ceiling = self.ceiling(attempt);
        let half = ceiling / 2;
        let spread = (ceiling - half).as_millis() as u64;
        half + Duration::from_millis(rand::thread_rng().gen_range(0..=spread))
    }
}

/// What a running job gets besides its args.
#[derive(Clone)]
pub struct JobContext {
    /// The queue row's id (also the run-history id for scheduled jobs).
    pub id: Uuid,
    /// This run's number, starting at 1.
    pub attempt: u32,
    pub max_attempts: u32,
    /// Fires on operator cancel, timeout and shutdown.
    pub cancel: CancellationToken,
    pub(crate) observer: Arc<dyn RunObserver>,
}

impl JobContext {
    /// A context for calling a job's `perform` directly in tests.
    #[cfg(test)]
    pub(crate) fn for_test(observer: Arc<dyn RunObserver>) -> Self {
        Self {
            id: Uuid::new_v4(),
            attempt: 1,
            max_attempts: 1,
            cancel: CancellationToken::new(),
            observer,
        }
    }

    /// No retry follows if this run fails.
    pub fn is_last_attempt(&self) -> bool {
        self.attempt >= self.max_attempts
    }

    /// Record how far the run has got (shown in run history). Cheap to
    /// call, but throttle it in tight loops.
    pub async fn progress(&self, detail: serde_json::Value) {
        self.observer.progressed(self.id, &detail).await;
    }
}

/// How a run ended, as reported to the [`RunObserver`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunOutcome {
    Succeeded,
    /// Failed; another attempt is scheduled at `retry_at` (ISO-8601 UTC).
    Retrying {
        error: String,
        retry_at: String,
    },
    /// Failed for the last time; the job is in the dead set.
    Failed {
        error: String,
    },
    /// Stopped by an operator.
    Cancelled,
    /// Interrupted by shutdown; it runs again after restart.
    Interrupted,
}

/// Hears about run lifecycle events so they can be recorded (run
/// history for the admin page). The runner never waits on anything but
/// these calls, so implementations should be quick and must not fail
/// the run: they log their own errors.
#[async_trait]
pub trait RunObserver: Send + Sync {
    async fn started(&self, id: Uuid, kind: &str, attempt: u32);
    async fn progressed(&self, id: Uuid, detail: &serde_json::Value);
    async fn finished(&self, id: Uuid, kind: &str, outcome: &RunOutcome);
}

/// An observer that records nothing (tests, ad-hoc runners).
pub struct NoObserver;

#[async_trait]
impl RunObserver for NoObserver {
    async fn started(&self, _: Uuid, _: &str, _: u32) {}
    async fn progressed(&self, _: Uuid, _: &serde_json::Value) {}
    async fn finished(&self, _: Uuid, _: &str, _: &RunOutcome) {}
}

type BoxFuture = Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>>;
type Handler = Arc<dyn Fn(JobContext, serde_json::Value) -> BoxFuture + Send + Sync>;

#[derive(Clone)]
pub(crate) struct Registered {
    pub handler: Handler,
    pub policy: JobPolicy,
}

/// Every job kind this process can run. Built once at boot from the
/// job catalog, then shared read-only with the runner.
#[derive(Default, Clone)]
pub struct JobRegistry {
    jobs: HashMap<&'static str, Registered>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register `job` under its [`Job::KIND`]. Panics on a duplicate kind
    /// — two handlers for one kind is a programming error caught at boot.
    pub fn add<J: Job>(&mut self, job: J) {
        let policy = job.policy();
        let job = Arc::new(job);
        let handler: Handler = Arc::new(move |ctx, args| {
            let job = job.clone();
            Box::pin(async move {
                let args: J::Args = serde_json::from_value(args)
                    .map_err(|e| anyhow::anyhow!("bad args for {}: {e}", J::KIND))?;
                job.perform(&ctx, args).await
            })
        });
        let previous = self.jobs.insert(J::KIND, Registered { handler, policy });
        assert!(
            previous.is_none(),
            "job kind {:?} registered twice",
            J::KIND
        );
    }

    pub(crate) fn get(&self, kind: &str) -> Option<&Registered> {
        self.jobs.get(kind)
    }

    /// The policy for `kind` (the default for unknown kinds).
    pub fn policy(&self, kind: &str) -> JobPolicy {
        self.jobs
            .get(kind)
            .map(|r| r.policy.clone())
            .unwrap_or_default()
    }

    pub fn contains(&self, kind: &str) -> bool {
        self.jobs.contains_key(kind)
    }

    /// Registered kinds, sorted.
    pub fn kinds(&self) -> Vec<&'static str> {
        let mut kinds: Vec<_> = self.jobs.keys().copied().collect();
        kinds.sort_unstable();
        kinds
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_up_to_the_cap() {
        let b = Backoff {
            base: Duration::from_secs(10),
            cap: Duration::from_secs(60),
        };
        assert_eq!(b.ceiling(1), Duration::from_secs(10));
        assert_eq!(b.ceiling(2), Duration::from_secs(20));
        assert_eq!(b.ceiling(3), Duration::from_secs(40));
        assert_eq!(b.ceiling(4), Duration::from_secs(60));
        assert_eq!(b.ceiling(u32::MAX), Duration::from_secs(60));
    }

    #[test]
    fn backoff_delay_stays_in_the_upper_half() {
        let b = Backoff::default();
        for attempt in 1..8 {
            let ceiling = b.ceiling(attempt);
            for _ in 0..50 {
                let d = b.delay(attempt);
                assert!(d >= ceiling / 2 && d <= ceiling, "{d:?} vs {ceiling:?}");
            }
        }
    }

    struct Echo;

    #[async_trait]
    impl Job for Echo {
        const KIND: &'static str = "test.echo";
        type Args = u32;
        fn policy(&self) -> JobPolicy {
            JobPolicy {
                max_attempts: 2,
                ..JobPolicy::default()
            }
        }
        async fn perform(&self, _: &JobContext, args: u32) -> anyhow::Result<()> {
            anyhow::ensure!(args == 7, "expected 7");
            Ok(())
        }
    }

    fn ctx() -> JobContext {
        JobContext {
            id: Uuid::new_v4(),
            attempt: 1,
            max_attempts: 2,
            cancel: CancellationToken::new(),
            observer: Arc::new(NoObserver),
        }
    }

    #[tokio::test]
    async fn registry_decodes_args_and_keeps_the_policy() {
        let mut r = JobRegistry::new();
        r.add(Echo);
        assert_eq!(r.kinds(), vec!["test.echo"]);
        assert_eq!(r.policy("test.echo").max_attempts, 2);
        assert_eq!(r.policy("nope").max_attempts, 5);
        let job = r.get("test.echo").unwrap();
        assert!((job.handler)(ctx(), serde_json::json!(7)).await.is_ok());
        assert!((job.handler)(ctx(), serde_json::json!(8)).await.is_err());
        let bad = (job.handler)(ctx(), serde_json::json!("x"))
            .await
            .unwrap_err();
        assert!(bad.to_string().contains("bad args"), "{bad}");
    }

    #[test]
    #[should_panic(expected = "registered twice")]
    fn duplicate_kinds_are_refused() {
        let mut r = JobRegistry::new();
        r.add(Echo);
        r.add(Echo);
    }
}
