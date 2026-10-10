//! Job service — recurring jobs and their run history: schedule listing
//! and editing, "run now", cancelling, default-schedule seeding, the
//! scheduler tick, and recording each run's lifecycle (it is the
//! worker runner's [`RunObserver`]).
//!
//! ## Runs
//!
//! A run of a catalog job is one queue job and one `job_run` row sharing
//! an id. "Run now" and the scheduler both enqueue with the
//! [`SINGLE_RUN`] unique key, so a job never runs twice at once — not
//! even with several app instances. The runner reports start, progress,
//! retries and the outcome here; job code only reports progress.
//!
//! ## The tick
//!
//! [`JobService::spawn_scheduler`] runs every `tick_interval_secs`:
//!
//! 1. marks runs whose queue job is gone as failed (e.g. a run that was
//!    queued when the queue table was replaced), and prunes history and
//!    dead jobs past the retention window (hourly);
//! 2. for each due schedule, claims the slot by moving `next_run_at`
//!    forward with a compare-and-set — with several instances exactly
//!    one wins — and the winner enqueues the run. Missed slots are
//!    skipped, not replayed.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::Utc;
use sea_orm::Set;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::config::Config;
use crate::dto::admin::{
    CronJobListResponse, CronJobOut, CronJobRunListResponse, CronJobRunOut, UpdateCronJobRequest,
};
use crate::dto::job::status;
use crate::entity::{job_run, scheduled_job};
use crate::error::{AppError, AppResult};
use crate::jobs;
use crate::scheduler::{self, next_occurrence};
use crate::store::{now_iso, parse_iso, JobStore};
use crate::worker::{EnqueueOptions, Enqueued, JobQueue, RunCancels, RunObserver, RunOutcome};

/// The unique key every catalog-job run is queued with: one live run per
/// job at a time.
pub const SINGLE_RUN: &str = "single-run";

/// How often history and dead jobs are pruned (from the tick).
const PRUNE_INTERVAL: Duration = Duration::from_secs(3600);

pub struct JobService {
    store: Arc<dyn JobStore>,
    /// Present when the background-jobs subsystem runs in this process
    /// (`SCHEDULER_ENABLED`); without it "run now" answers 503.
    queue: Option<Arc<JobQueue>>,
    /// Running jobs in this process, for an immediate cancel.
    cancels: Arc<RunCancels>,
    config: Arc<Config>,
    last_prune: std::sync::Mutex<Option<std::time::Instant>>,
}

impl JobService {
    pub fn new(store: Arc<dyn JobStore>, config: Arc<Config>) -> Self {
        Self {
            store,
            queue: None,
            cancels: Arc::new(RunCancels::new()),
            config,
            last_prune: std::sync::Mutex::new(None),
        }
    }

    /// The cancel registry the worker runner shares with this service.
    pub fn run_cancels(&self) -> Arc<RunCancels> {
        self.cancels.clone()
    }

    /// Attach the queue (bootstrap, when the worker starts).
    pub fn attach_queue(&mut self, queue: Arc<JobQueue>) {
        self.queue = Some(queue);
    }

    fn tz_offset(&self) -> i32 {
        self.config.scheduler.tz_offset_minutes
    }

    fn queue(&self) -> AppResult<&Arc<JobQueue>> {
        self.queue.as_ref().ok_or_else(|| {
            AppError::ServiceUnavailable(
                "background jobs are not running in this process (SCHEDULER_ENABLED=false)"
                    .to_string(),
            )
        })
    }

    // ── Seeding ────────────────────────────────────────────────────

    /// Seed the default schedule of every catalog job that has none yet
    /// (operator edits are never overwritten), and remove schedules of
    /// jobs that left the catalog.
    pub async fn ensure_default_jobs(&self) -> AppResult<()> {
        for def in jobs::catalog() {
            let Some(schedule) = def.schedule else {
                continue; // on-demand job: no schedule row
            };
            if self.store.find_schedule(def.kind).await?.is_some() {
                continue;
            }
            let next = next_occurrence(
                Utc::now(),
                schedule.at_hour,
                schedule.at_minute,
                self.tz_offset(),
            );
            let now = now_iso();
            self.store
                .insert_schedule(scheduled_job::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    job_type: Set(def.kind.to_string()),
                    enabled: Set(true),
                    interval_days: Set(schedule.interval_days),
                    at_hour: Set(schedule.at_hour),
                    at_minute: Set(schedule.at_minute),
                    next_run_at: Set(Some(iso(next))),
                    created_at: Set(now.clone()),
                    updated_at: Set(now),
                })
                .await?;
            tracing::info!(kind = def.kind, next_run_at = %iso(next), "seeded default schedule");
        }
        for schedule in self.store.list_schedules().await? {
            if jobs::find_definition(&schedule.job_type).is_none()
                && self.store.delete_schedule(&schedule.job_type).await?
            {
                tracing::info!(kind = %schedule.job_type, "removed the schedule of a job no longer in the catalog");
            }
        }
        Ok(())
    }

    // ── Admin reads ────────────────────────────────────────────────

    /// All schedules, each with its latest run.
    pub async fn list_schedules(&self) -> AppResult<CronJobListResponse> {
        let schedules = self.store.list_schedules().await?;
        let mut items = Vec::with_capacity(schedules.len());
        for s in schedules {
            let last_run = self.store.latest_run(&s.job_type).await?;
            items.push(schedule_out(s, last_run));
        }
        Ok(CronJobListResponse {
            items,
            scheduler_enabled: self.queue.is_some(),
        })
    }

    /// Run history (most recent first), optionally for one job.
    pub async fn list_runs(
        &self,
        job_type: Option<&str>,
        limit: Option<u64>,
    ) -> AppResult<CronJobRunListResponse> {
        let limit = limit.unwrap_or(20).clamp(1, 100);
        let runs = self.store.list_runs(job_type, limit).await?;
        Ok(CronJobRunListResponse {
            items: runs.into_iter().map(run_out).collect(),
        })
    }

    // ── Admin writes ───────────────────────────────────────────────

    /// Enable/disable a schedule, change its cadence or time of day, or
    /// re-arm it. Cadence changes re-arm from now (otherwise a shortened
    /// interval would only apply after the previously armed slot).
    pub async fn update_schedule(
        &self,
        job_type: &str,
        req: &UpdateCronJobRequest,
    ) -> AppResult<CronJobOut> {
        let model = self
            .store
            .find_schedule(job_type)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("no schedule for job {job_type:?}")))?;

        let mut am: scheduled_job::ActiveModel = model.clone().into();
        if let Some(enabled) = req.enabled {
            am.enabled = Set(enabled);
        }
        let cadence_changed =
            req.interval_days.is_some() || req.at_hour.is_some() || req.at_minute.is_some();
        if let Some(days) = req.interval_days {
            am.interval_days = Set(days);
        }
        if let Some(h) = req.at_hour {
            am.at_hour = Set(h);
        }
        if let Some(m) = req.at_minute {
            am.at_minute = Set(m);
        }
        if req.reset_next_run.unwrap_or(false) || cadence_changed {
            let next = next_occurrence(
                Utc::now(),
                req.at_hour.unwrap_or(model.at_hour).max(0),
                req.at_minute.unwrap_or(model.at_minute).max(0),
                self.tz_offset(),
            );
            am.next_run_at = Set(Some(iso(next)));
        }
        am.updated_at = Set(now_iso());

        let updated = self.store.update_schedule(am).await?;
        let last_run = self.store.latest_run(&updated.job_type).await?;
        Ok(schedule_out(updated, last_run))
    }

    /// Queue a run now (the admin "run now" button, and the scheduler).
    /// Refuses while a run of the same job is queued or running.
    pub async fn trigger(&self, job_type: &str) -> AppResult<CronJobRunOut> {
        jobs::find_definition(job_type)
            .ok_or_else(|| AppError::NotFound(format!("no job {job_type:?}")))?;
        let queue = self.queue()?;

        // The history row exists before the job can be claimed, so the
        // runner always finds it.
        let id = Uuid::new_v4();
        let run = self
            .store
            .insert_run(job_run::ActiveModel {
                id: Set(id),
                job_type: Set(job_type.to_string()),
                status: Set(status::QUEUED.into()),
                detail: Set(None),
                error: Set(None),
                started_at: Set(None),
                finished_at: Set(None),
                created_at: Set(now_iso()),
            })
            .await?;

        let enqueued = queue
            .enqueue_raw(
                job_type,
                serde_json::Value::Null,
                EnqueueOptions {
                    id: Some(id),
                    unique_key: Some(SINGLE_RUN.to_string()),
                    ..EnqueueOptions::default()
                },
            )
            .await;
        match enqueued {
            Ok(Enqueued::Inserted(_)) => {
                tracing::info!(job_type, run_id = %id, "job queued");
                Ok(run_out(run))
            }
            Ok(Enqueued::Duplicate(existing)) => {
                let _ = self.store.delete_run(id).await;
                Err(AppError::Conflict(format!(
                    "{job_type} is already queued or running (run {existing}) — wait for it to finish"
                )))
            }
            Err(e) => {
                let _ = self.store.delete_run(id).await;
                Err(AppError::Worker(format!("enqueue: {e}")))
            }
        }
    }

    /// Cancel the queued or running run of a job (the admin cancel
    /// button). A queued run is removed; a running one stops at once in
    /// this process, or at its worker's next lease renewal in another.
    pub async fn cancel(&self, job_type: &str) -> AppResult<CronJobRunOut> {
        let queue = self.queue()?;
        let job = queue
            .live_by_key(job_type, SINGLE_RUN)
            .await
            .map_err(|e| AppError::Worker(e.to_string()))?
            .ok_or_else(|| {
                AppError::NotFound(format!("{job_type} has no queued or running run"))
            })?;
        queue
            .cancel(job.id)
            .await
            .map_err(|e| AppError::Worker(e.to_string()))?;
        self.cancels.cancel(job.id);
        let now = now_iso();
        self.store
            .set_run_state(job.id, status::CANCELLED, None, None, Some(&now))
            .await?;
        tracing::info!(job_type, run_id = %job.id, "run cancelled by an operator");
        let run = self
            .store
            .find_run(job.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("run {} not found", job.id)))?;
        Ok(run_out(run))
    }

    // ── Scheduler tick ─────────────────────────────────────────────

    /// Spawn the tick loop; it stops when `shutdown` fires.
    pub fn spawn_scheduler(self: &Arc<Self>, shutdown: CancellationToken) -> JoinHandle<()> {
        let svc = Arc::clone(self);
        let interval = Duration::from_secs(svc.config.scheduler.tick_interval_secs.max(1));
        tokio::spawn(async move {
            // First tick at once: settle runs a previous process left.
            svc.tick_once().await;
            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => {
                        tracing::info!("scheduler stopped");
                        break;
                    }
                    _ = tokio::time::sleep(interval) => svc.tick_once().await,
                }
            }
        })
    }

    /// One scheduler pass (also driven directly by tests).
    pub async fn tick_once(&self) {
        if let Err(e) = self.tick_inner().await {
            tracing::warn!(error = %e, "scheduler tick failed");
        }
    }

    async fn tick_inner(&self) -> anyhow::Result<()> {
        self.settle_orphaned_runs().await;
        self.prune().await;

        let now = Utc::now();
        for schedule in self.store.find_due_schedules(&iso(now)).await? {
            let next = match &schedule.next_run_at {
                Some(slot) => scheduler::catch_up(
                    parse_iso(slot)?,
                    schedule.interval_days.max(1),
                    schedule.at_hour.max(0),
                    schedule.at_minute.max(0),
                    self.tz_offset(),
                    now,
                ),
                None => next_occurrence(
                    now,
                    schedule.at_hour.max(0),
                    schedule.at_minute.max(0),
                    self.tz_offset(),
                ),
            };
            // Claim the slot first: only the instance that moves it fires.
            let claimed = self
                .store
                .advance_schedule(
                    &schedule.job_type,
                    schedule.next_run_at.as_deref(),
                    &iso(next),
                    &now_iso(),
                )
                .await?;
            if !claimed {
                continue;
            }
            match self.trigger(&schedule.job_type).await {
                Ok(run) => {
                    tracing::info!(job_type = %schedule.job_type, run_id = %run.id, "scheduled run queued")
                }
                // A run is still going: this slot is skipped.
                Err(AppError::Conflict(reason)) => {
                    tracing::info!(job_type = %schedule.job_type, %reason, "scheduled run skipped")
                }
                Err(e) => {
                    tracing::warn!(job_type = %schedule.job_type, error = %e, "scheduled run failed to queue")
                }
            }
        }
        Ok(())
    }

    /// Runs still marked queued/running whose queue job no longer exists
    /// can never finish: mark them failed.
    async fn settle_orphaned_runs(&self) {
        let Some(queue) = &self.queue else { return };
        let runs = match self.store.list_active_runs().await {
            Ok(runs) => runs,
            Err(e) => return tracing::warn!(error = %e, "listing active runs failed"),
        };
        for run in runs {
            match queue.get(run.id).await {
                Ok(Some(_)) => {}
                Ok(None) => {
                    let now = now_iso();
                    let error = "interrupted: its queued job no longer exists";
                    if let Err(e) = self
                        .store
                        .set_run_state(run.id, status::FAILED, Some(error), None, Some(&now))
                        .await
                    {
                        tracing::warn!(run_id = %run.id, error = %e, "could not settle an orphaned run");
                    }
                }
                Err(e) => tracing::warn!(run_id = %run.id, error = %e, "queue lookup failed"),
            }
        }
    }

    /// Delete finished runs and dead jobs older than the retention window
    /// (`JOB_RUN_RETENTION_DAYS`, default 30, 0 = keep forever). Hourly.
    async fn prune(&self) {
        let days = self.config.scheduler.job_run_retention_days;
        if days == 0 {
            return;
        }
        {
            let mut last = self.last_prune.lock().unwrap();
            match *last {
                Some(t) if t.elapsed() < PRUNE_INTERVAL => return,
                _ => *last = Some(std::time::Instant::now()),
            }
        }
        let cutoff = Utc::now() - chrono::Duration::days(days as i64);
        match self.store.prune_finished_runs(&iso(cutoff)).await {
            Ok(0) => {}
            Ok(n) => tracing::info!(n, retention_days = days, "pruned old run history"),
            Err(e) => tracing::warn!(error = %e, "run history prune failed"),
        }
        if let Some(queue) = &self.queue {
            match queue.prune_dead(cutoff).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(n, retention_days = days, "pruned old dead jobs"),
                Err(e) => tracing::warn!(error = %e, "dead job prune failed"),
            }
        }
    }
}

/// Run history is written from the runner's lifecycle events. Jobs
/// without a `job_run` row (queued outside the scheduler) are no-ops.
#[async_trait]
impl RunObserver for JobService {
    async fn started(&self, id: Uuid, _kind: &str, _attempt: u32) {
        let now = now_iso();
        if let Err(e) = self
            .store
            .set_run_state(id, status::RUNNING, None, Some(&now), None)
            .await
        {
            tracing::warn!(run_id = %id, error = %e, "could not record run start");
        }
    }

    async fn progressed(&self, id: Uuid, detail: &serde_json::Value) {
        if let Err(e) = self.store.set_run_detail(id, &detail.to_string()).await {
            tracing::warn!(run_id = %id, error = %e, "could not record run progress");
        }
    }

    async fn finished(&self, id: Uuid, _kind: &str, outcome: &RunOutcome) {
        let now = now_iso();
        let result = match outcome {
            RunOutcome::Succeeded => {
                self.store
                    .set_run_state(id, status::SUCCEEDED, None, None, Some(&now))
                    .await
            }
            RunOutcome::Retrying { error, retry_at } => {
                let error = format!("{error} — retrying at {retry_at}");
                self.store
                    .set_run_state(id, status::QUEUED, Some(&error), None, None)
                    .await
            }
            RunOutcome::Failed { error } => {
                self.store
                    .set_run_state(id, status::FAILED, Some(error), None, Some(&now))
                    .await
            }
            RunOutcome::Cancelled => {
                self.store
                    .set_run_state(id, status::CANCELLED, None, None, Some(&now))
                    .await
            }
            // Runs again after restart.
            RunOutcome::Interrupted => {
                self.store
                    .set_run_state(id, status::QUEUED, None, None, None)
                    .await
            }
        };
        if let Err(e) = result {
            tracing::warn!(run_id = %id, error = %e, "could not record run outcome");
        }
    }
}

fn iso(t: chrono::DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn schedule_out(s: scheduled_job::Model, last_run: Option<job_run::Model>) -> CronJobOut {
    CronJobOut {
        description: jobs::find_definition(&s.job_type).map(|d| d.description.to_string()),
        job_type: s.job_type,
        enabled: s.enabled,
        interval_days: s.interval_days,
        at_hour: s.at_hour,
        at_minute: s.at_minute,
        next_run_at: s.next_run_at,
        last_run: last_run.map(run_out),
        updated_at: s.updated_at,
    }
}

/// Map a `job_run` row to its DTO, parsing `detail` JSON leniently.
fn run_out(run: job_run::Model) -> CronJobRunOut {
    CronJobRunOut {
        id: run.id,
        job_type: run.job_type,
        status: run.status,
        detail: run.detail.and_then(|d| serde_json::from_str(&d).ok()),
        error: run.error,
        started_at: run.started_at,
        finished_at: run.finished_at,
        created_at: run.created_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{migrated_test_db, DbJobQueueStore, DbJobStore};
    use crate::worker::Job;
    use validator::Validate;

    const OSM: &str = jobs::osm_import::OsmImport::KIND;

    fn test_config() -> Arc<Config> {
        Arc::new(Config {
            scheduler: crate::config::SchedulerConfig {
                enabled: true,
                tz_offset_minutes: 420,
                tick_interval_secs: 60,
                job_run_retention_days: 30,
            },
            ..Default::default()
        })
    }

    /// A service over a migrated in-memory DB, with or without a queue.
    async fn service(with_queue: bool) -> (JobService, Arc<DbJobStore>, Option<Arc<JobQueue>>) {
        let db = migrated_test_db().await;
        let store = Arc::new(DbJobStore::new(db.clone()));
        let mut svc = JobService::new(store.clone(), test_config());
        let queue = with_queue.then(|| Arc::new(JobQueue::new(Arc::new(DbJobQueueStore::new(db)))));
        if let Some(q) = &queue {
            svc.attach_queue(q.clone());
        }
        (svc, store, queue)
    }

    async fn insert_schedule(store: &DbJobStore, job_type: &str, next_run_at: Option<String>) {
        let now = now_iso();
        store
            .insert_schedule(scheduled_job::ActiveModel {
                id: Set(Uuid::new_v4()),
                job_type: Set(job_type.to_string()),
                enabled: Set(true),
                interval_days: Set(14),
                at_hour: Set(2),
                at_minute: Set(0),
                next_run_at: Set(next_run_at),
                created_at: Set(now.clone()),
                updated_at: Set(now),
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn seeding_is_idempotent_and_drops_schedules_of_removed_jobs() {
        let (svc, store, _) = service(false).await;
        insert_schedule(&store, "removed.job", None).await;
        svc.ensure_default_jobs().await.unwrap();
        svc.ensure_default_jobs().await.unwrap();

        let schedules = store.list_schedules().await.unwrap();
        assert_eq!(schedules.len(), 1, "only catalog jobs keep a schedule");
        assert_eq!(schedules[0].job_type, OSM);
        assert_eq!((schedules[0].interval_days, schedules[0].at_hour), (14, 2));
        let next = parse_iso(schedules[0].next_run_at.as_deref().unwrap()).unwrap();
        assert!(next > Utc::now());
    }

    #[tokio::test]
    async fn trigger_needs_a_queue_and_a_catalog_job() {
        let (svc, _, _) = service(false).await;
        assert!(matches!(
            svc.trigger(OSM).await.unwrap_err(),
            AppError::ServiceUnavailable(_)
        ));
        let (svc, _, _) = service(true).await;
        assert!(matches!(
            svc.trigger("nope.job").await.unwrap_err(),
            AppError::NotFound(_)
        ));
    }

    #[tokio::test]
    async fn a_job_cannot_be_queued_twice_at_once() {
        let (svc, store, queue) = service(true).await;
        let run = svc.trigger(OSM).await.unwrap();
        assert_eq!(run.status, status::QUEUED);
        let job = queue.as_ref().unwrap().get(run.id).await.unwrap().unwrap();
        assert_eq!(job.kind, OSM, "the queue job shares the run's id");

        assert!(matches!(
            svc.trigger(OSM).await.unwrap_err(),
            AppError::Conflict(_)
        ));
        assert_eq!(
            store.count_runs(OSM).await.unwrap(),
            1,
            "the refused run leaves no row"
        );
    }

    #[tokio::test]
    async fn cancelling_a_queued_run_removes_it() {
        let (svc, store, queue) = service(true).await;
        let run = svc.trigger(OSM).await.unwrap();
        let cancelled = svc.cancel(OSM).await.unwrap();
        assert_eq!(cancelled.status, status::CANCELLED);
        assert!(queue.unwrap().get(run.id).await.unwrap().is_none());
        assert!(matches!(
            svc.cancel(OSM).await.unwrap_err(),
            AppError::NotFound(_)
        ));
        // The job can be queued again.
        svc.trigger(OSM).await.unwrap();
        assert_eq!(store.count_runs(OSM).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn the_tick_fires_a_due_slot_once_and_advances_it() {
        let (svc, store, _) = service(true).await;
        insert_schedule(&store, OSM, Some("2020-01-01T00:00:00Z".into())).await;

        svc.tick_once().await;
        assert_eq!(store.count_runs(OSM).await.unwrap(), 1);
        let schedule = store.find_schedule(OSM).await.unwrap().unwrap();
        assert!(parse_iso(schedule.next_run_at.as_deref().unwrap()).unwrap() > Utc::now());

        // Nothing is due any more, and a second instance's tick finds the
        // slot already moved.
        svc.tick_once().await;
        assert_eq!(store.count_runs(OSM).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn run_history_follows_the_runner_events() {
        let (svc, store, _) = service(true).await;
        let run = svc.trigger(OSM).await.unwrap();

        svc.started(run.id, OSM, 1).await;
        svc.progressed(run.id, &serde_json::json!({ "phase": "indexing" }))
            .await;
        let row = store.find_run(run.id).await.unwrap().unwrap();
        assert_eq!(row.status, status::RUNNING);
        assert!(row.started_at.is_some());

        let retry = RunOutcome::Retrying {
            error: "boom".into(),
            retry_at: "later".into(),
        };
        svc.finished(run.id, OSM, &retry).await;
        let row = store.find_run(run.id).await.unwrap().unwrap();
        assert_eq!(row.status, status::QUEUED);
        assert!(row.error.as_deref().unwrap().contains("boom"));

        svc.finished(run.id, OSM, &RunOutcome::Succeeded).await;
        let row = store.find_run(run.id).await.unwrap().unwrap();
        assert_eq!(row.status, status::SUCCEEDED);
        assert!(row.error.is_none() && row.finished_at.is_some());
        assert!(
            row.detail.as_deref().unwrap().contains("indexing"),
            "progress is kept"
        );
    }

    #[tokio::test]
    async fn runs_whose_queue_job_vanished_are_marked_failed() {
        let (svc, store, _) = service(true).await;
        let orphan = store
            .insert_run(job_run::ActiveModel {
                id: Set(Uuid::new_v4()),
                job_type: Set(OSM.into()),
                status: Set(status::QUEUED.into()),
                detail: Set(None),
                error: Set(None),
                started_at: Set(None),
                finished_at: Set(None),
                created_at: Set(now_iso()),
            })
            .await
            .unwrap();
        let live = svc.trigger(OSM).await.unwrap();
        svc.tick_once().await;
        assert_eq!(
            store.find_run(orphan.id).await.unwrap().unwrap().status,
            status::FAILED
        );
        assert_eq!(
            store.find_run(live.id).await.unwrap().unwrap().status,
            status::QUEUED
        );
    }

    #[tokio::test]
    async fn update_schedule_validates_and_rearms() {
        let (svc, store, _) = service(false).await;
        insert_schedule(&store, OSM, None).await;
        let out = svc
            .update_schedule(
                OSM,
                &UpdateCronJobRequest {
                    enabled: Some(false),
                    interval_days: Some(7),
                    at_hour: Some(3),
                    at_minute: Some(30),
                    reset_next_run: None,
                },
            )
            .await
            .unwrap();
        assert!(!out.enabled);
        assert_eq!((out.interval_days, out.at_hour, out.at_minute), (7, 3, 30));
        assert!(parse_iso(&out.next_run_at.unwrap()).unwrap() > Utc::now());

        let req: UpdateCronJobRequest =
            serde_json::from_value(serde_json::json!({ "intervalDays": 0 })).unwrap();
        assert!(req.validate().is_err());
        let req: UpdateCronJobRequest =
            serde_json::from_value(serde_json::json!({ "atHour": 24 })).unwrap();
        assert!(req.validate().is_err());
    }

    #[tokio::test]
    async fn list_schedules_reports_whether_jobs_run_here() {
        let (svc, store, _) = service(false).await;
        insert_schedule(&store, OSM, None).await;
        let out = svc.list_schedules().await.unwrap();
        assert!(!out.scheduler_enabled);
        assert_eq!(out.items.len(), 1);
        assert!(out.items[0].description.is_some());
        assert!(out.items[0].last_run.is_none());
    }

    #[tokio::test]
    async fn pruning_keeps_fresh_and_live_history() {
        let (svc, store, _) = service(true).await;
        let old = (Utc::now() - chrono::Duration::days(90))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let fresh = (Utc::now() - chrono::Duration::days(1))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let mk = |status: &str, finished: &str| job_run::ActiveModel {
            id: Set(Uuid::new_v4()),
            job_type: Set("prune.test".into()),
            status: Set(status.into()),
            detail: Set(None),
            error: Set(None),
            started_at: Set(Some(finished.to_string())),
            finished_at: Set(Some(finished.to_string())),
            created_at: Set(finished.to_string()),
        };
        store.insert_run(mk(status::SUCCEEDED, &old)).await.unwrap();
        store.insert_run(mk(status::FAILED, &old)).await.unwrap();
        store
            .insert_run(mk(status::SUCCEEDED, &fresh))
            .await
            .unwrap();
        svc.prune().await;
        assert_eq!(store.count_runs("prune.test").await.unwrap(), 1);
        svc.prune().await; // throttled: a no-op
        assert_eq!(store.count_runs("prune.test").await.unwrap(), 1);
    }
}
