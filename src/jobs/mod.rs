//! Background job implementations — the **catalog pattern**.
//!
//! [`catalog`] is the single static list of every built-in background
//! job. Both consumers read it:
//!
//! * [`register_all`] — installs each job's handler + policy into the
//!   worker [`JobRegistry`] at bootstrap,
//! * [`JobService::ensure_default_jobs`](crate::service::job_service::JobService::ensure_default_jobs)
//!   — seeds each job's default schedule row (idempotently; operator
//!   edits are never overwritten).
//!
//! ## Adding a new background job — the whole checklist
//!
//! 1. **Write the handler module** `src/jobs/<name>.rs`:
//!    * `pub const JOB_TYPE: &str = "<domain>.<verb>";` — the identity
//!      used by the worker queue, the `scheduled_job` table, the admin
//!      cron-jobs page and the trigger API.
//!    * `pub fn register(registry: &JobRegistry, deps: JobDeps)` —
//!      installs the handler together with its
//!      [`JobPolicy`](crate::worker::JobPolicy) (timeout / max
//!      attempts) via `registry.register_with_policy`. The handler is
//!      any `Fn(JobEnvelope) -> Future<Output = anyhow::Result<()>>`;
//!      capture whatever it needs from `deps` by clone.
//!    * The handler decodes [`RunPayload`] from the envelope to find
//!      its `job_run` history row and reports progress there — see
//!      `osm_import` for the full pattern (lifecycle transitions +
//!      throttled progress writes).
//! 2. **Add one entry to [`catalog`]** (plus `pub mod <name>;`):
//!    job type, human description, and the default schedule — or
//!    `None` for a trigger-only job that never fires automatically.
//!
//! Nothing else: the worker runner, schedule seeding, scheduler tick,
//! admin cron-jobs page, "run now" API and run-history sweep all pick
//! the job up from the catalog.

pub mod osm_import;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::Config;
use crate::service::PlaceService;
use crate::store::JobStore;
use crate::worker::JobRegistry;

/// Dependencies shared by the built-in job handlers. Cheap to clone
/// (three `Arc`s); each registration captures its own copy so the
/// handler is `'static` and can be spawned by the runner.
#[derive(Clone)]
pub struct JobDeps {
    pub job_store: Arc<dyn JobStore>,
    pub places: Arc<PlaceService>,
    pub config: Arc<Config>,
}

/// The payload every framework-triggered run carries: which `job_run`
/// row tracks this execution. [`JobService::trigger`] enqueues exactly
/// this; handlers decode it (leniently — job-specific extra fields may
/// be present on manually-built envelopes, and `run_id` may be absent,
/// in which case the handler inserts a fresh history row).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunPayload {
    pub run_id: Option<Uuid>,
}

impl RunPayload {
    /// The payload for a tracked run (the trigger / scheduler path).
    pub fn for_run(run_id: Uuid) -> Self {
        Self {
            run_id: Some(run_id),
        }
    }
}

/// Default schedule of a catalog job: "every `interval_days` days at
/// `at_hour:at_minute` local wall-clock" (see the `scheduler` module
/// for how "local" is resolved — a fixed UTC offset, UTC+7 default).
#[derive(Debug, Clone, Copy)]
pub struct JobSchedule {
    pub interval_days: i16,
    pub at_hour: i16,
    pub at_minute: i16,
}

/// Static registration record for one built-in background job.
pub struct JobDefinition {
    /// Job identity across queue / DB / admin UI (e.g. `osm.import`).
    pub job_type: &'static str,
    /// Human one-liner surfaced on the admin cron-jobs page.
    pub description: &'static str,
    /// Default schedule seeded on boot (idempotent). `None` = the job
    /// is trigger-only; no schedule row is created.
    pub schedule: Option<JobSchedule>,
    /// Wire the handler + [`JobPolicy`] into the worker registry.
    /// Plain `fn` pointer: all state comes in via [`JobDeps`].
    pub register: fn(&JobRegistry, JobDeps),
}

/// The catalog — every built-in background job, in one place.
/// See the module docs for how to extend it.
pub fn catalog() -> &'static [JobDefinition] {
    &[JobDefinition {
        job_type: osm_import::JOB_TYPE,
        description: "Vietnam OSM extract → Tantivy place-index refresh \
                          (download, staged low-resource rebuild, atomic swap, \
                          hot reload, cleanup).",
        schedule: Some(JobSchedule {
            // Biweekly at 02:00 local (UTC+7 default): night hours,
            // the site's quiet window, per the requirements.
            interval_days: 14,
            at_hour: 2,
            at_minute: 0,
        }),
        register: osm_import::register,
    }]
}

/// Look up a catalog definition by job type (admin labels, validation).
pub fn find_definition(job_type: &str) -> Option<&'static JobDefinition> {
    catalog().iter().find(|d| d.job_type == job_type)
}

/// Install every catalog job's handler + policy into a fresh
/// registry. Called from `server::bootstrap` after the services exist,
/// before the runner spawns.
pub fn register_all(deps: JobDeps) -> Arc<JobRegistry> {
    let registry = Arc::new(JobRegistry::new());
    for def in catalog() {
        (def.register)(&registry, deps.clone());
    }
    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_job_types_are_unique_and_nonempty() {
        let cat = catalog();
        assert!(!cat.is_empty(), "the catalog must list the built-in jobs");
        for (i, def) in cat.iter().enumerate() {
            assert!(!def.job_type.is_empty());
            for other in &cat[..i] {
                assert_ne!(
                    def.job_type, other.job_type,
                    "duplicate job_type {:?} in the catalog",
                    def.job_type
                );
            }
            assert!(!def.description.is_empty(), "every job needs a description");
        }
    }

    #[test]
    fn osm_import_default_schedule_is_biweekly_night() {
        let def = find_definition(osm_import::JOB_TYPE).expect("osm.import in catalog");
        let schedule = def.schedule.expect("osm.import has a default schedule");
        assert_eq!(schedule.interval_days, 14);
        assert_eq!((schedule.at_hour, schedule.at_minute), (2, 0));
        // "Night" contract from the requirements.
        assert!(schedule.at_hour < 6);
    }

    /// The ergonomic contract this module promises: a catalog entry is
    /// sufficient — its `register` fn installs a handler AND a
    /// non-default policy into a fresh registry, with nothing else
    /// wired. If a future job forgets `register_with_policy`, this
    /// catches it here instead of as a silent drop in production.
    #[tokio::test]
    async fn every_catalog_entry_registers_a_handler_and_policy() {
        let db = sea_orm::Database::connect("sqlite::memory:").await.unwrap();
        let job_store: Arc<dyn JobStore> = Arc::new(crate::store::DbJobStore::new(Arc::new(db)));
        let deps = JobDeps {
            job_store,
            places: Arc::new(crate::service::PlaceService::new(
                crate::store::CompositeStore::in_memory().await,
            )),
            config: Arc::new(Config::default()),
        };

        let registry = register_all(deps);
        for def in catalog() {
            assert!(
                registry.get(def.job_type).is_some(),
                "no handler registered for {:?}",
                def.job_type
            );
            let policy = registry.policy(def.job_type);
            // Every catalog job must register an EXPLICIT policy (not
            // the 5-minute default) — long jobs get killed by the
            // default timeout otherwise.
            assert!(
                policy.timeout.as_secs() != 300 || policy.max_attempts != 10,
                "{:?} registered the default policy — long-running jobs \
                 need an explicit timeout/max_attempts",
                def.job_type
            );
        }
    }
}
