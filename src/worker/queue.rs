//! The job queue: queueing rules on top of [`JobQueueStore`] (the
//! `background_job` table — see its migration for the column contract).
//!
//! Guarantees:
//! * **At-least-once.** Claiming a job leases it instead of deleting it;
//!   the runner renews the lease while the job runs and deletes the row
//!   only on success. If the process dies, the lease runs out and the
//!   next claim picks the job up again — nothing is lost, so jobs must
//!   tolerate running twice.
//! * **Retries with backoff**, then a **dead set**: a failure puts the
//!   job back with a later `run_at`; one that runs out of attempts stays
//!   as `dead` with its last error instead of disappearing.
//! * **De-duplication**: at most one live job per `(kind, unique_key)`.
//!
//! Enqueueing wakes idle workers in this process at once; other
//! processes notice at their next poll.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, SecondsFormat, Utc};
use sea_orm::Set;
use serde::Serialize;
use tokio::sync::Notify;
use uuid::Uuid;

use crate::entity::background_job;
use crate::store::job_queue::{AVAILABLE, CANCELLED, DEAD, RUNNING};
use crate::store::JobQueueStore;

use super::job::Job;

/// Fixed-width UTC timestamp (milliseconds): text order is time order.
pub(crate) fn ts(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn now() -> String {
    ts(Utc::now())
}

fn after(d: Duration) -> String {
    ts(Utc::now() + chrono::Duration::from_std(d).unwrap_or_else(|_| chrono::Duration::days(365)))
}

/// Options for one enqueue.
#[derive(Debug, Clone, Default)]
pub struct EnqueueOptions {
    /// Use this id (e.g. to link a run-history row) instead of a new one.
    pub id: Option<Uuid>,
    /// Do not run before this instant (default: now).
    pub run_at: Option<DateTime<Utc>>,
    /// Lower runs first (default 0).
    pub priority: i16,
    /// At most one live job per `(kind, unique_key)`.
    pub unique_key: Option<String>,
}

/// What an enqueue did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Enqueued {
    /// A new job with this id.
    Inserted(Uuid),
    /// A live job with the same `(kind, unique_key)` already exists.
    Duplicate(Uuid),
}

/// A job a worker has leased.
#[derive(Debug, Clone)]
pub struct ClaimedJob {
    pub id: Uuid,
    pub kind: String,
    pub args: serde_json::Value,
    /// This run's number (1 = first).
    pub attempt: u32,
}

/// A queued job as shown to operators.
#[derive(Debug, Clone, Serialize)]
pub struct QueuedJob {
    pub id: Uuid,
    pub kind: String,
    pub state: String,
    pub attempt: u32,
    pub run_at: String,
    pub last_error: Option<String>,
    pub updated_at: String,
}

impl From<background_job::Model> for QueuedJob {
    fn from(m: background_job::Model) -> Self {
        Self {
            id: m.id,
            kind: m.kind,
            state: m.state,
            attempt: m.attempt.max(0) as u32,
            run_at: m.run_at,
            last_error: m.last_error,
            updated_at: m.updated_at,
        }
    }
}

/// Jobs per state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct QueueCounts {
    pub available: u64,
    pub running: u64,
    pub dead: u64,
}

pub struct JobQueue {
    store: Arc<dyn JobQueueStore>,
    wake: Arc<Notify>,
}

impl JobQueue {
    pub fn new(store: Arc<dyn JobQueueStore>) -> Self {
        Self {
            store,
            wake: Arc::new(Notify::new()),
        }
    }

    /// Fires whenever this process makes a job runnable.
    pub(crate) fn wake_signal(&self) -> Arc<Notify> {
        self.wake.clone()
    }

    /// Enqueue a typed job.
    pub async fn enqueue<J: Job>(
        &self,
        args: &J::Args,
        opts: EnqueueOptions,
    ) -> anyhow::Result<Enqueued> {
        self.enqueue_raw(J::KIND, serde_json::to_value(args)?, opts)
            .await
    }

    /// Enqueue by kind name (the scheduler and admin triggers, which know
    /// jobs only by their catalog kind).
    pub async fn enqueue_raw(
        &self,
        kind: &str,
        args: serde_json::Value,
        opts: EnqueueOptions,
    ) -> anyhow::Result<Enqueued> {
        let id = opts.id.unwrap_or_else(Uuid::new_v4);
        let created = now();
        let inserted = self
            .store
            .insert_job(background_job::ActiveModel {
                id: Set(id),
                kind: Set(kind.to_string()),
                args: Set(serde_json::to_string(&args)?),
                state: Set(AVAILABLE.to_string()),
                priority: Set(opts.priority),
                attempt: Set(0),
                run_at: Set(opts.run_at.map(ts).unwrap_or_else(|| created.clone())),
                locked_by: Set(None),
                locked_until: Set(None),
                unique_key: Set(opts.unique_key.clone()),
                last_error: Set(None),
                created_at: Set(created.clone()),
                updated_at: Set(created),
            })
            .await?;
        if inserted {
            self.wake.notify_waiters();
            return Ok(Enqueued::Inserted(id));
        }
        // Not inserted: only the unique key can collide (ids are fresh).
        let key = opts
            .unique_key
            .ok_or_else(|| anyhow::anyhow!("job {id} was not inserted"))?;
        let existing = self
            .store
            .find_by_key(kind, &key)
            .await?
            .ok_or_else(|| anyhow::anyhow!("job {kind}/{key} vanished during enqueue"))?;
        Ok(Enqueued::Duplicate(existing.id))
    }

    /// The live job holding `(kind, unique_key)`, if any.
    pub async fn live_by_key(
        &self,
        kind: &str,
        unique_key: &str,
    ) -> anyhow::Result<Option<QueuedJob>> {
        Ok(self
            .store
            .find_by_key(kind, unique_key)
            .await?
            .map(QueuedJob::from))
    }

    /// The job with this id, if it is still queued, running or dead.
    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<QueuedJob>> {
        Ok(self.store.find_job(id).await?.map(QueuedJob::from))
    }

    /// Lease the next due job to `worker` for `lease` (expired leases
    /// included — that is the crash recovery).
    pub(crate) async fn claim(
        &self,
        worker: &str,
        lease: Duration,
    ) -> anyhow::Result<Option<ClaimedJob>> {
        let Some(row) = self.store.claim_next(worker, &now(), &after(lease)).await? else {
            return Ok(None);
        };
        Ok(Some(ClaimedJob {
            id: row.id,
            kind: row.kind,
            args: serde_json::from_str(&row.args).unwrap_or(serde_json::Value::Null),
            attempt: row.attempt.max(1) as u32,
        }))
    }

    /// Extend `worker`'s lease. `false` = the lease is gone: the job was
    /// cancelled, or another worker took it over after an expiry.
    pub(crate) async fn renew(
        &self,
        id: Uuid,
        worker: &str,
        lease: Duration,
    ) -> anyhow::Result<bool> {
        Ok(self
            .store
            .renew_lease(id, worker, &now(), &after(lease))
            .await?)
    }

    /// Done (succeeded, or stopped on purpose): remove the row.
    pub(crate) async fn finish(&self, id: Uuid, worker: &str) -> anyhow::Result<()> {
        Ok(self.store.delete_held(id, worker).await?)
    }

    /// Failed with attempts left: run again at `at`.
    pub(crate) async fn retry(
        &self,
        id: Uuid,
        worker: &str,
        at: DateTime<Utc>,
        error: &str,
    ) -> anyhow::Result<()> {
        self.store
            .requeue(id, worker, &ts(at), error, &now())
            .await?;
        self.wake.notify_waiters();
        Ok(())
    }

    /// Interrupted by shutdown: hand the job back as it was (the
    /// interrupted attempt does not count), due right away.
    pub(crate) async fn release(&self, id: Uuid, worker: &str) -> anyhow::Result<()> {
        Ok(self.store.release(id, worker, &now()).await?)
    }

    /// Out of attempts: keep the row as `dead`, freeing its unique key so
    /// the same work can be queued again.
    pub(crate) async fn bury(&self, id: Uuid, worker: &str, error: &str) -> anyhow::Result<()> {
        Ok(self.store.mark_dead(id, worker, error, &now()).await?)
    }

    /// Cancel a job: a waiting one is removed outright; a running one is
    /// flagged and its worker stops at the next lease renewal. Returns
    /// whether there was anything to cancel.
    pub async fn cancel(&self, id: Uuid) -> anyhow::Result<bool> {
        if self.store.delete_waiting(id).await? {
            return Ok(true);
        }
        Ok(self.store.flag_cancelled(id, &now()).await?)
    }

    /// Delete dead jobs last touched before `before`.
    pub async fn prune_dead(&self, before: DateTime<Utc>) -> anyhow::Result<u64> {
        Ok(self.store.delete_dead_before(&ts(before)).await?)
    }

    /// How many jobs wait, run and are dead.
    pub async fn counts(&self) -> anyhow::Result<QueueCounts> {
        let mut counts = QueueCounts::default();
        for (state, n) in self.store.count_by_state().await? {
            let n = n.max(0) as u64;
            match state.as_str() {
                AVAILABLE => counts.available += n,
                RUNNING | CANCELLED => counts.running += n,
                DEAD => counts.dead += n,
                _ => {}
            }
        }
        Ok(counts)
    }

    /// The most recently failed dead jobs.
    pub async fn dead_jobs(&self, limit: u64) -> anyhow::Result<Vec<QueuedJob>> {
        Ok(self
            .store
            .list_dead(limit)
            .await?
            .into_iter()
            .map(QueuedJob::from)
            .collect())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::store::{migrated_test_db, DbJobQueueStore};

    pub(crate) async fn queue() -> JobQueue {
        JobQueue::new(Arc::new(DbJobQueueStore::new(migrated_test_db().await)))
    }

    const LEASE: Duration = Duration::from_secs(60);

    fn null() -> serde_json::Value {
        serde_json::Value::Null
    }

    #[tokio::test]
    async fn claim_leases_and_finish_deletes() {
        let q = queue().await;
        let Enqueued::Inserted(id) = q
            .enqueue_raw(
                "t.a",
                serde_json::json!({"n": 1}),
                EnqueueOptions::default(),
            )
            .await
            .unwrap()
        else {
            panic!("expected insert")
        };
        let job = q.claim("w1", LEASE).await.unwrap().unwrap();
        assert_eq!((job.id, job.attempt), (id, 1));
        assert_eq!(job.args["n"], 1);
        // Leased: nobody else gets it.
        assert!(q.claim("w2", LEASE).await.unwrap().is_none());
        assert!(q.renew(id, "w1", LEASE).await.unwrap());
        assert!(
            !q.renew(id, "w2", LEASE).await.unwrap(),
            "only the holder renews"
        );
        q.finish(id, "w1").await.unwrap();
        assert!(q.get(id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn an_expired_lease_is_claimed_again() {
        let q = queue().await;
        q.enqueue_raw("t.a", null(), EnqueueOptions::default())
            .await
            .unwrap();
        let first = q
            .claim("dead-worker", Duration::ZERO)
            .await
            .unwrap()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
        let again = q.claim("w2", LEASE).await.unwrap().unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(again.attempt, 2, "the crashed run counts as an attempt");
        assert!(!q.renew(first.id, "dead-worker", LEASE).await.unwrap());
    }

    #[tokio::test]
    async fn retry_waits_for_run_at_and_bury_keeps_a_dead_row() {
        let q = queue().await;
        q.enqueue_raw("t.a", null(), EnqueueOptions::default())
            .await
            .unwrap();
        let job = q.claim("w", LEASE).await.unwrap().unwrap();
        q.retry(job.id, "w", Utc::now() + chrono::Duration::hours(1), "boom")
            .await
            .unwrap();
        assert!(q.claim("w", LEASE).await.unwrap().is_none(), "not due yet");
        assert_eq!(q.counts().await.unwrap().available, 1);

        q.enqueue_raw("t.b", null(), EnqueueOptions::default())
            .await
            .unwrap();
        let b = q.claim("w", LEASE).await.unwrap().unwrap();
        q.bury(b.id, "w", "gave up").await.unwrap();
        let dead = q.dead_jobs(10).await.unwrap();
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0].last_error.as_deref(), Some("gave up"));
        assert_eq!(
            q.counts().await.unwrap(),
            QueueCounts {
                available: 1,
                running: 0,
                dead: 1
            }
        );
        assert_eq!(
            q.prune_dead(Utc::now() + chrono::Duration::seconds(1))
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn unique_keys_dedupe_live_jobs_only() {
        let q = queue().await;
        let opts = || EnqueueOptions {
            unique_key: Some("singleton".into()),
            ..EnqueueOptions::default()
        };
        let Enqueued::Inserted(id) = q.enqueue_raw("t.a", null(), opts()).await.unwrap() else {
            panic!("expected insert")
        };
        assert_eq!(
            q.enqueue_raw("t.a", null(), opts()).await.unwrap(),
            Enqueued::Duplicate(id)
        );
        // Another kind may use the same key; jobs without a key never collide.
        assert!(matches!(
            q.enqueue_raw("t.b", null(), opts()).await.unwrap(),
            Enqueued::Inserted(_)
        ));
        for _ in 0..2 {
            assert!(matches!(
                q.enqueue_raw("t.a", null(), EnqueueOptions::default())
                    .await
                    .unwrap(),
                Enqueued::Inserted(_)
            ));
        }
        // Once the job is dead the key is free again.
        let job = loop {
            let j = q.claim("w", LEASE).await.unwrap().unwrap();
            if j.id == id {
                break j;
            }
            q.finish(j.id, "w").await.unwrap();
        };
        q.bury(job.id, "w", "x").await.unwrap();
        assert!(matches!(
            q.enqueue_raw("t.a", null(), opts()).await.unwrap(),
            Enqueued::Inserted(_)
        ));
    }

    #[tokio::test]
    async fn cancel_removes_waiting_jobs_and_flags_running_ones() {
        let q = queue().await;
        let later = EnqueueOptions {
            run_at: Some(Utc::now() + chrono::Duration::hours(1)),
            ..EnqueueOptions::default()
        };
        let Enqueued::Inserted(waiting) = q.enqueue_raw("t.a", null(), later).await.unwrap() else {
            panic!()
        };
        assert!(q.cancel(waiting).await.unwrap());
        assert!(q.get(waiting).await.unwrap().is_none());

        q.enqueue_raw("t.a", null(), EnqueueOptions::default())
            .await
            .unwrap();
        let running = q.claim("w", LEASE).await.unwrap().unwrap();
        assert!(q.cancel(running.id).await.unwrap());
        assert!(
            !q.renew(running.id, "w", LEASE).await.unwrap(),
            "the worker learns at renewal"
        );
        q.finish(running.id, "w").await.unwrap();
        assert!(
            !q.cancel(running.id).await.unwrap(),
            "nothing left to cancel"
        );
    }

    #[tokio::test]
    async fn release_hands_the_job_back_without_spending_an_attempt() {
        let q = queue().await;
        q.enqueue_raw("t.a", null(), EnqueueOptions::default())
            .await
            .unwrap();
        let job = q.claim("w", LEASE).await.unwrap().unwrap();
        q.release(job.id, "w").await.unwrap();
        let again = q.claim("w", LEASE).await.unwrap().unwrap();
        assert_eq!((again.id, again.attempt), (job.id, 1));
    }

    #[tokio::test]
    async fn priority_then_due_time_orders_claims() {
        let q = queue().await;
        let early = Utc::now() - chrono::Duration::minutes(5);
        for (kind, priority, run_at) in [
            ("late", 0, None),
            ("early", 0, Some(early)),
            ("urgent", -1, None),
        ] {
            let opts = EnqueueOptions {
                priority,
                run_at,
                ..EnqueueOptions::default()
            };
            q.enqueue_raw(kind, null(), opts).await.unwrap();
        }
        let mut order = vec![];
        while let Some(j) = q.claim("w", LEASE).await.unwrap() {
            order.push(j.kind.clone());
            q.finish(j.id, "w").await.unwrap();
        }
        assert_eq!(order, ["urgent", "early", "late"]);
    }
}
