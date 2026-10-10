//! Built-in background jobs — the **catalog**.
//!
//! [`catalog`] lists every built-in job once. At boot it is read twice:
//!
//! * [`register_all`] installs each job into the worker's
//!   [`JobRegistry`],
//! * [`JobService::ensure_default_jobs`](crate::service::job_service::JobService::ensure_default_jobs)
//!   seeds each job's default schedule (once; operator edits are kept)
//!   and removes schedules of jobs that left the catalog.
//!
//! ## Adding a job
//!
//! 1. Write `src/jobs/<name>.rs` with a struct implementing
//!    [`Job`]: a stable `KIND` (`<domain>.<verb>`),
//!    its `Args`, a [`JobPolicy`](crate::worker::JobPolicy) if the
//!    defaults (5 min timeout, 5 attempts) don't fit, and `perform`.
//!    Report progress with `ctx.progress(...)`; the runner records
//!    start, retries and the final outcome in run history itself.
//! 2. Add `pub mod <name>;` and one [`JobDefinition`] to [`catalog`]:
//!    kind, description, default schedule (`None` = run on demand only)
//!    and how to build it from [`JobDeps`].
//!
//! Jobs that are not scheduled can also be queued from anywhere with
//! `JobQueue::enqueue::<MyJob>(&args, options)`.
//!
//! ## Removing a job
//!
//! Delete its module and catalog entry. On the next boot its schedule
//! row is removed; queued rows of the old kind end up in the dead set
//! (visible, not silently dropped).

pub mod osm_import;

use std::sync::Arc;

use crate::config::Config;
use crate::service::PlaceService;
use crate::worker::{Job, JobRegistry};

/// What the built-in jobs are built from. Cheap to clone.
#[derive(Clone)]
pub struct JobDeps {
    pub places: Arc<PlaceService>,
    pub config: Arc<Config>,
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

/// One built-in job.
pub struct JobDefinition {
    /// Its `Job::KIND` — identity across queue, history and admin page.
    pub kind: &'static str,
    /// One line for the admin page.
    pub description: &'static str,
    /// Default schedule, seeded once. `None` = run on demand only.
    pub schedule: Option<JobSchedule>,
    /// Build the job from `deps` and add it to the registry.
    pub register: fn(&mut JobRegistry, &JobDeps),
}

/// Every built-in job. See the module docs for adding one.
pub fn catalog() -> &'static [JobDefinition] {
    &[JobDefinition {
        kind: osm_import::OsmImport::KIND,
        description: "Vietnam OSM extract → Tantivy place-index refresh \
                      (download, staged low-resource rebuild, atomic swap, \
                      hot reload, cleanup).",
        schedule: Some(JobSchedule {
            // Biweekly at 02:00 local (UTC+7 default): the site's quiet
            // night hours.
            interval_days: 14,
            at_hour: 2,
            at_minute: 0,
        }),
        register: |registry, deps| registry.add(osm_import::OsmImport::new(deps)),
    }]
}

/// The catalog entry for `kind`.
pub fn find_definition(kind: &str) -> Option<&'static JobDefinition> {
    catalog().iter().find(|d| d.kind == kind)
}

/// A registry with every catalog job, built at boot.
pub fn register_all(deps: &JobDeps) -> JobRegistry {
    let mut registry = JobRegistry::new();
    for def in catalog() {
        (def.register)(&mut registry, deps);
        assert!(
            registry.contains(def.kind),
            "catalog entry {:?} registered a job with a different KIND",
            def.kind
        );
    }
    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_kinds_are_unique_and_described() {
        let cat = catalog();
        assert!(!cat.is_empty(), "the catalog must list the built-in jobs");
        for (i, def) in cat.iter().enumerate() {
            assert!(!def.kind.is_empty());
            assert!(!def.description.is_empty(), "every job needs a description");
            assert!(
                cat[..i].iter().all(|other| other.kind != def.kind),
                "duplicate kind {:?} in the catalog",
                def.kind
            );
        }
    }

    #[test]
    fn osm_import_default_schedule_is_biweekly_night() {
        let def = find_definition(osm_import::OsmImport::KIND).expect("osm.import in catalog");
        let schedule = def.schedule.expect("osm.import has a default schedule");
        assert_eq!(schedule.interval_days, 14);
        assert_eq!((schedule.at_hour, schedule.at_minute), (2, 0));
        assert!(schedule.at_hour < 6, "runs at night");
    }

    /// Every catalog entry registers its job, and long jobs bring their
    /// own policy (the 5-minute default would kill them).
    #[tokio::test]
    async fn every_catalog_entry_registers_its_job() {
        let deps = JobDeps {
            places: Arc::new(crate::service::PlaceService::new(
                crate::store::CompositeStore::in_memory().await,
            )),
            config: Arc::new(Config::default()),
        };
        let registry = register_all(&deps);
        for def in catalog() {
            assert!(registry.contains(def.kind), "{:?} not registered", def.kind);
        }
        assert!(
            registry
                .policy(osm_import::OsmImport::KIND)
                .timeout
                .as_secs()
                > 3600
        );
    }
}
