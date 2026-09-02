//! `osm.import` — the scheduled Vietnam OSM → Tantivy refresh job.
//!
//! Pipeline (one job run):
//!
//! 1. **Download** the Geofabrik Vietnam extract, streaming to
//!    `<pbf>.part` then renaming (`osm::download`).
//! 2. **Index** into a *staging* directory next to the live one, with
//!    the low-resource profile ([`IndexOptions::default`]: 256 MB heap,
//!    1 thread, FirstNode centroids) — slow but gentle on RAM/CPU, per
//!    the "runs at night on a shared box" requirement. Progress lands
//!    in the `job_run.detail` JSON.
//! 3. **Swap**: live → `.old`, staging → live, then remove `.old`. The
//!    live index is never touched until the new one is fully built, so
//!    search keeps serving the old data throughout (and keeps serving
//!    it forever if the import fails).
//! 4. **Activate**: `PlaceService::activate` hot-swaps the running
//!    server's reader — no restart needed.
//! 5. **Cleanup**: the ~500 MB PBF and any `.part` / staging leftovers
//!    are deleted, success or failure.
//!
//! Failure semantics: the handler marks the `job_run` row failed and
//! returns `Err`, so the runner retries once (`max_attempts = 2`).
//! The retry re-downloads from scratch — acceptable for a biweekly
//! night job.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use sea_orm::Set;
use serde_json::json;
use uuid::Uuid;

use crate::config::Config;
use crate::entity::job_run;
use crate::osm::download;
use crate::osm::indexer::{self, IndexOptions, IndexStats};
use crate::service::PlaceService;
use crate::store::{now_iso, JobStore};
use crate::worker::{JobEnvelope, JobPolicy, JobRegistry};

use super::{JobDeps, RunPayload};

/// Worker job type handled here — the identity shared with the
/// `jobs::catalog` entry and the `scheduled_job` row seeded by
/// `JobService::ensure_default_jobs`.
pub const JOB_TYPE: &str = "osm.import";

/// Wall-clock budget. The download + single-threaded 3-pass index can
/// legitimately take a few hours on a small VM; 6 h is the kill line
/// (the runner then nacks → one retry).
const TIMEOUT: Duration = Duration::from_secs(6 * 3600);

// ── Single-flight guard ─────────────────────────────────────────
//
// The runner's timeout drops the handler future but a `spawn_blocking`
// body keeps running. This flag lives in the blocking closure, so a
// retry arriving while an orphaned indexer still writes to staging is
// refused instead of corrupting the same directory.

static IMPORT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct ImportGuard;

impl ImportGuard {
    /// Acquire the single-flight slot. `None` when an import (possibly
    /// an orphaned indexer thread) is still running.
    fn acquire() -> Option<Self> {
        (!IMPORT_IN_FLIGHT.swap(true, Ordering::AcqRel)).then(|| ImportGuard)
    }
}

impl Drop for ImportGuard {
    fn drop(&mut self) {
        IMPORT_IN_FLIGHT.store(false, Ordering::Release);
    }
}

/// Register the handler + policy on the worker registry. Referenced by
/// the `jobs::catalog` entry (a plain `fn` pointer — all state arrives
/// via `deps`).
pub fn register(registry: &JobRegistry, deps: JobDeps) {
    let JobDeps {
        job_store,
        places,
        config,
    } = deps;
    registry.register_with_policy(
        JOB_TYPE,
        move |env: JobEnvelope| {
            let job_store = job_store.clone();
            let places = places.clone();
            let config = config.clone();
            async move { run(env, &job_store, &places, &config).await }
        },
        JobPolicy {
            timeout: TIMEOUT,
            max_attempts: 2,
        },
    );
}

/// Everything the handler needs, resolved from config once.
struct ImportPaths {
    index_dir: PathBuf,
    staging_dir: PathBuf,
    pbf_path: PathBuf,
    download_url: String,
}

impl ImportPaths {
    fn resolve(config: &Config) -> anyhow::Result<Self> {
        let index_dir = config.search.index_dir.clone().ok_or_else(|| {
            anyhow::anyhow!("SEARCH_INDEX_DIR must be set for scheduled OSM imports")
        })?;
        Ok(Self {
            staging_dir: sibling_dir(&index_dir, "staging"),
            // Same default as `.env.example` / the download script.
            pbf_path: config
                .search
                .osm_pbf_path
                .clone()
                .unwrap_or_else(|| PathBuf::from("./data/vietnam-latest.osm.pbf")),
            download_url: config
                .search
                .osm_download_url
                .clone()
                .unwrap_or_else(|| download::VIETNAM_PBF_URL.to_string()),
            index_dir,
        })
    }
}

/// `<dir>.<suffix>` in the same parent — e.g.
/// `osm-index` → `osm-index.staging`.
fn sibling_dir(dir: &Path, suffix: &str) -> PathBuf {
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    dir.with_file_name(format!("{name}.{suffix}"))
}

/// Handler entry point.
async fn run(
    env: JobEnvelope,
    job_store: &Arc<dyn JobStore>,
    places: &Arc<PlaceService>,
    config: &Arc<Config>,
) -> anyhow::Result<()> {
    let payload: RunPayload = env
        .decode_payload()
        .unwrap_or(RunPayload { run_id: None });
    let paths = ImportPaths::resolve(config)?;

    // Resolve (or create) the history row this execution reports into.
    let mut run_row = match payload.run_id {
        Some(id) => job_store
            .find_run(id)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?
            .ok_or_else(|| anyhow::anyhow!("job run row {id} not found"))?,
        None => insert_run(job_store, JOB_TYPE).await?,
    };

    // queued → running
    {
        let mut am: job_run::ActiveModel = run_row.clone().into();
        am.status = Set(job_run::status::RUNNING.into());
        am.started_at = Set(Some(now_iso()));
        am.error = Set(None);
        am.detail = Set(Some(
            json!({ "phase": "downloading", "message": "starting download" }).to_string(),
        ));
        run_row = job_store
            .update_run(am)
            .await
            .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    }
    let run_id = run_row.id;
    tracing::info!(run_id = %run_id, attempt = env.attempts + 1, "osm.import started");

    // Progress writer: forwards detail-JSON updates to the DB without
    // read-modify-write (a full-row UPDATE here could race the lifecycle
    // transitions below and resurrect a stale status).
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    let progress_store = job_store.clone();
    let progress_task = tokio::spawn(async move {
        while let Some(detail) = rx.recv().await {
            if let Err(e) = progress_store
                .set_run_detail(run_id, &detail.to_string())
                .await
            {
                tracing::warn!(error = %e, "failed to persist job progress detail");
            }
        }
    });

    let result = execute(&paths, places, &tx).await;

    // Stop the progress writer BEFORE the final lifecycle write so a
    // late progress update can't clobber the terminal status/detail.
    drop(tx);
    let _ = progress_task.await;

    match result {
        Ok(stats) => {
            let detail = json!({
                "phase": "done",
                "message": format!(
                    "indexed {} places ({} nodes, {} ways, {} admin relations)",
                    stats.indexed, stats.nodes, stats.ways, stats.admins
                ),
                "stats": {
                    "indexed": stats.indexed,
                    "nodes": stats.nodes,
                    "ways": stats.ways,
                    "admins": stats.admins,
                },
            });
            let mut am: job_run::ActiveModel = run_row.into();
            am.status = Set(job_run::status::SUCCEEDED.into());
            am.detail = Set(Some(detail.to_string()));
            am.finished_at = Set(Some(now_iso()));
            am.error = Set(None);
            let _ = job_store.update_run(am).await;
            tracing::info!(run_id = %run_id, "osm.import succeeded");
            Ok(())
        }
        Err(e) => {
            let message = e.to_string();
            let mut am: job_run::ActiveModel = run_row.into();
            am.status = Set(job_run::status::FAILED.into());
            am.error = Set(Some(message.clone()));
            am.finished_at = Set(Some(now_iso()));
            let _ = job_store.update_run(am).await;
            // Propagate so the runner performs the retry (max 2).
            tracing::warn!(run_id = %run_id, error = %message, "osm.import failed");
            Err(e)
        }
    }
}

/// The actual pipeline. Errors propagate to the caller which marks the
/// run row failed — cleanup still runs on every exit path.
async fn execute(
    paths: &ImportPaths,
    places: &Arc<PlaceService>,
    tx: &tokio::sync::mpsc::UnboundedSender<serde_json::Value>,
) -> anyhow::Result<IndexStats> {
    let outcome = execute_inner(paths, places, tx).await;
    // Cleanup happens on success AND failure: the PBF is a transient
    // artifact of the import, and staging/.part leftovers would only
    // confuse the next run. The LIVE index is never cleaned here —
    // removing it is swap's job (on success only).
    cleanup(paths);
    outcome
}

async fn execute_inner(
    paths: &ImportPaths,
    places: &Arc<PlaceService>,
    tx: &tokio::sync::mpsc::UnboundedSender<serde_json::Value>,
) -> anyhow::Result<IndexStats> {
    // ── 1. Download ──────────────────────────────────────────────
    let client = download::client()?;
    let tx_dl = tx.clone();
    let last_reported = std::sync::atomic::AtomicU64::new(0);
    download::download_file(&client, &paths.download_url, &paths.pbf_path, &move |bytes| {
        // Throttle: a progress row every 64 MiB (the callback itself
        // fires per ~8-64 KiB chunk).
        let last = last_reported.load(Ordering::Relaxed);
        if bytes.saturating_sub(last) >= 64 * 1024 * 1024 {
            last_reported.store(bytes, Ordering::Relaxed);
            let _ = tx_dl.send(json!({
                "phase": "downloading",
                "message": format!("{:.0} MiB downloaded", bytes as f64 / 1_048_576.0),
                "bytes": bytes,
            }));
        }
    })
    .await?;

    // ── 2+3. Index into staging, then swap (single-flight) ───────
    let _ = tx.send(json!({
        "phase": "indexing",
        "message": "indexing extract into staging directory",
    }));

    let staging = paths.staging_dir.clone();
    let live = paths.index_dir.clone();
    let pbf = paths.pbf_path.clone();
    let tx_idx = tx.clone();
    let progress = Arc::new(move |msg: &str| {
        let _ = tx_idx.send(json!({
            "phase": "indexing",
            "message": msg,
        }));
    });

    let stats = {
        // Index + swap are plain fs work — keep them off the async
        // runtime, and hold the single-flight guard for their whole
        // duration.
        let guard = match ImportGuard::acquire() {
            Some(g) => g,
            None => {
                anyhow::bail!(
                    "another osm.import is already running (or an orphaned \
                     indexer is still finishing) — skipping this attempt"
                )
            }
        };
        let result = tokio::task::spawn_blocking(move || {
            let _guard = guard; // lives for the whole closure
            // Stale staging from a crashed run would corrupt a rebuild.
            let _ = std::fs::remove_dir_all(&staging);
            let opts = IndexOptions {
                progress: Some(progress),
                ..IndexOptions::default()
            };
            let stats = indexer::run_index(&pbf, &staging, &opts)?;
            swap_index_dirs(&live, &staging)?;
            Ok::<_, anyhow::Error>(stats)
        })
        .await
        .map_err(|e| anyhow::anyhow!("indexing task join error: {e}"))??;
        result
    };

    // ── 4. Activate the new index on the running server ─────────
    let _ = tx.send(json!({
        "phase": "activating",
        "message": "activating the new index on the running server",
    }));
    if let Err(e) = places.activate(&paths.index_dir) {
        // The on-disk index is valid; only the hot-reload failed. Log +
        // record it, but don't fail a multi-hour run over it — a server
        // restart picks the new index up.
        tracing::warn!(error = %e, "place index hot-reload failed — restart to pick it up");
        let _ = tx.send(json!({
            "phase": "activating",
            "message": format!("index published; hot-reload failed ({e}) — restart to pick it up"),
        }));
    }

    Ok(stats)
}

/// Publish `staging` as the new live index directory.
///
/// live → `.old`, staging → live, remove `.old`. If the second rename
/// fails, the old index is restored — the live dir must never end up
/// missing after having existed.
pub(crate) fn swap_index_dirs(live: &Path, staging: &Path) -> anyhow::Result<()> {
    let old = sibling_dir(live, "old");
    let had_live = live.exists();
    if had_live {
        std::fs::rename(live, &old)?;
    }
    match std::fs::rename(staging, live) {
        Ok(()) => {
            if had_live {
                let _ = std::fs::remove_dir_all(&old);
            }
            tracing::info!(live = %live.display(), "new place index published");
            Ok(())
        }
        Err(e) => {
            // Rollback so search keeps its old index.
            if had_live {
                let _ = std::fs::rename(&old, live);
            }
            anyhow::bail!("publishing new index to {} failed: {e}", live.display())
        }
    }
}

/// Remove the transient artifacts of an import: the PBF, its `.part`
/// sibling, staging leftovers, and any `.old` directory.
fn cleanup(paths: &ImportPaths) {
    let _ = std::fs::remove_file(&paths.pbf_path);
    download::cleanup_partial(&paths.pbf_path);
    let _ = std::fs::remove_dir_all(&paths.staging_dir);
    let _ = std::fs::remove_dir_all(sibling_dir(&paths.index_dir, "old"));
}

/// Insert a fresh `queued` row and return it as `running`-ready model.
async fn insert_run(
    job_store: &Arc<dyn JobStore>,
    job_type: &str,
) -> anyhow::Result<job_run::Model> {
    let now = now_iso();
    let am = job_run::ActiveModel {
        id: Set(Uuid::new_v4()),
        job_type: Set(job_type.to_string()),
        status: Set(job_run::status::QUEUED.into()),
        detail: Set(None),
        error: Set(None),
        started_at: Set(None),
        finished_at: Set(None),
        created_at: Set(now),
    };
    job_store
        .insert_run(am)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sibling_dir_appends_suffix_in_same_parent() {
        assert_eq!(
            sibling_dir(Path::new("/data/osm-index"), "staging"),
            PathBuf::from("/data/osm-index.staging")
        );
        assert_eq!(
            sibling_dir(Path::new("/data/osm-index"), "old"),
            PathBuf::from("/data/osm-index.old")
        );
    }

    #[test]
    fn guard_is_single_flight_and_reusable() {
        let g1 = ImportGuard::acquire();
        assert!(g1.is_some());
        assert!(ImportGuard::acquire().is_none(), "second acquire must fail");
        drop(g1);
        assert!(ImportGuard::acquire().is_some(), "guard must be reusable after drop");
    }

    #[test]
    fn swap_publishes_staging_and_removes_old() {
        let live = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        std::fs::write(staging.path().join("meta.json"), "new").unwrap();
        std::fs::write(live.path().join("meta.json"), "old").unwrap();

        swap_index_dirs(live.path(), staging.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(live.path().join("meta.json")).unwrap(),
            "new"
        );
        assert!(!sibling_dir(live.path(), "old").exists());
    }

    #[test]
    fn swap_without_existing_live_creates_it() {
        // First-ever import: the live dir doesn't exist yet.
        let parent = tempfile::tempdir().unwrap();
        let live = parent.path().join("osm-index");
        let staging = tempfile::tempdir().unwrap();
        std::fs::write(staging.path().join("meta.json"), "new").unwrap();

        swap_index_dirs(&live, staging.path()).unwrap();
        assert!(live.join("meta.json").exists());
    }

    #[test]
    fn swap_failure_restores_the_old_live_dir() {
        let live = tempfile::tempdir().unwrap();
        std::fs::write(live.path().join("meta.json"), "old").unwrap();
        // Staging does NOT exist → second rename fails → rollback.
        let missing = tempfile::tempdir().unwrap();
        let staging = missing.path().join("nope");

        let err = swap_index_dirs(live.path(), &staging).unwrap_err();
        assert!(err.to_string().contains("publishing"));
        // Old content restored.
        assert_eq!(
            std::fs::read_to_string(live.path().join("meta.json")).unwrap(),
            "old"
        );
    }
}

#[cfg(test)]
mod integration {
    use super::*;
    use crate::service::place_service::PlaceService;
    use crate::store::DbJobStore;
    use crate::store::CompositeStore;
    use sea_orm::{ConnectionTrait, Database, Set};

    /// Full handler failure path: unreachable download URL → run row
    //  marked failed with an error, no PBF / .part / staging leftovers.
    #[tokio::test]
    async fn failed_download_marks_run_failed_and_cleans_up() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        for stmt in [
            r#"CREATE TABLE job_run (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL,
                detail TEXT,
                error TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL
            )"#,
        ] {
            db.execute_unprepared(stmt).await.unwrap();
        }
        let db = Arc::new(db);
        let job_store: Arc<dyn JobStore> = Arc::new(DbJobStore::new(db.clone()));

        // Minimal PlaceService — activate is never reached (download fails).
        // Shared in-memory fixture over a fresh SQLite DB.
        let store = CompositeStore::in_memory().await;
        let places = Arc::new(PlaceService::new(store));

        let tmp = tempfile::tempdir().unwrap();
        let config = Arc::new(Config {
            search: crate::config::SearchConfig {
                index_dir: Some(tmp.path().join("osm-index")),
                osm_pbf_path: Some(tmp.path().join("vn.osm.pbf")),
                // Port 1 on localhost: connection refused immediately.
                osm_download_url: Some("http://127.0.0.1:1/vn.osm.pbf".into()),
            },
            ..Default::default()
        });

        // Pre-insert the queued run row the way `JobService::trigger` does.
        let queued_run = job_store
            .insert_run(job_run::ActiveModel {
                id: Set(Uuid::new_v4()),
                job_type: Set(JOB_TYPE.into()),
                status: Set(job_run::status::QUEUED.into()),
                detail: Set(None),
                error: Set(None),
                started_at: Set(None),
                finished_at: Set(None),
                created_at: Set(now_iso()),
            })
            .await
            .unwrap();

        let env = JobEnvelope::new(JOB_TYPE, &RunPayload::for_run(queued_run.id)).unwrap();
        let err = run(env, &job_store, &places, &config).await.unwrap_err();
        assert!(
            err.to_string().to_lowercase().contains("download")
                || err.to_string().contains("os error")
                || err.to_string().contains("requesting"),
            "unexpected error: {err}"
        );

        let row = job_store.find_run(queued_run.id).await.unwrap().unwrap();
        assert_eq!(row.status, job_run::status::FAILED);
        assert!(row.error.is_some());
        assert!(row.started_at.is_some());
        assert!(row.finished_at.is_some());
        // Progress detail was written (the "downloading" phase).
        let detail = row.detail.unwrap();
        assert!(detail.contains("phase"), "detail: {detail}");

        // Cleanup: no PBF, no .part, no staging dir.
        assert!(!tmp.path().join("vn.osm.pbf").exists());
        assert!(!tmp.path().join("vn.osm.pbf.part").exists());
        assert!(!tmp.path().join("osm-index.staging").exists());
    }
}
