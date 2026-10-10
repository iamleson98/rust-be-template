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
//!    in the run history.
//! 3. **Swap**: live → `.old`, staging → live, then remove `.old`. The
//!    live index is never touched until the new one is fully built, so
//!    search keeps serving the old data throughout (and keeps serving
//!    it forever if the import fails).
//! 4. **Activate**: `PlaceService::activate` hot-swaps the running
//!    server's reader — no restart needed.
//! 5. **Cleanup**: the ~500 MB PBF and any `.part` / staging leftovers
//!    are deleted, success or failure.
//!
//! Failure semantics: an error ends the attempt and the runner retries
//! once (`max_attempts = 2`, after a 10–20 minute pause). The retry
//! re-downloads from scratch — acceptable for a biweekly night job. The
//! runner records start, retry and outcome in run history; this job
//! only reports its progress.
//!
//! Cancellation (the admin cancel button, the timeout, shutdown) is
//! cooperative: every phase watches the run's token — the download via
//! `select!`, the blocking indexer via `IndexOptions::stop`. Cleanup
//! runs on the cancelled path too.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::config::Config;
use crate::osm::download;
use crate::osm::indexer::{self, IndexOptions, IndexStats};
use crate::service::PlaceService;
use crate::worker::{Backoff, Job, JobContext, JobPolicy};

use super::JobDeps;

/// Wall-clock budget. The download + single-threaded 3-pass index can
/// legitimately take a few hours on a small VM; 6 h is the kill line.
const TIMEOUT: Duration = Duration::from_secs(6 * 3600);

// ── Single-flight guard ─────────────────────────────────────────
//
// Cancelling stops the async side at once, but the blocking indexer only
// notices at its next stop check. This flag lives in the blocking
// closure, so a retry arriving while that indexer still writes to
// staging is refused instead of corrupting the same directory.

static IMPORT_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct ImportGuard;

impl ImportGuard {
    /// Acquire the single-flight slot. `None` when an import (possibly
    /// a winding-down indexer thread) is still running.
    fn acquire() -> Option<Self> {
        (!IMPORT_IN_FLIGHT.swap(true, Ordering::AcqRel)).then(|| ImportGuard)
    }
}

impl Drop for ImportGuard {
    fn drop(&mut self) {
        IMPORT_IN_FLIGHT.store(false, Ordering::Release);
    }
}

/// The run was cancelled (operator, timeout or shutdown).
#[derive(Debug)]
struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("cancelled")
    }
}

impl std::error::Error for Cancelled {}

/// The `osm.import` job.
pub struct OsmImport {
    places: Arc<PlaceService>,
    config: Arc<Config>,
}

impl OsmImport {
    pub fn new(deps: &JobDeps) -> Self {
        Self {
            places: deps.places.clone(),
            config: deps.config.clone(),
        }
    }
}

#[async_trait]
impl Job for OsmImport {
    const KIND: &'static str = "osm.import";
    type Args = ();

    fn policy(&self) -> JobPolicy {
        JobPolicy {
            timeout: TIMEOUT,
            max_attempts: 2,
            backoff: Backoff {
                base: Duration::from_secs(20 * 60),
                cap: Duration::from_secs(20 * 60),
            },
        }
    }

    async fn perform(&self, ctx: &JobContext, _: ()) -> anyhow::Result<()> {
        let paths = ImportPaths::resolve(&self.config)?;
        tracing::info!(job_id = %ctx.id, attempt = ctx.attempt, "osm.import started");
        ctx.progress(json!({ "phase": "downloading", "message": "starting download" }))
            .await;

        // Progress arrives from sync callbacks (some on the blocking
        // indexer thread): forward it through a channel, in order.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
        let forward_ctx = ctx.clone();
        let forward = tokio::spawn(async move {
            while let Some(detail) = rx.recv().await {
                forward_ctx.progress(detail).await;
            }
        });

        let result = execute(&paths, &self.places, &tx, &ctx.cancel).await;
        // Drain the progress queue before the final report.
        drop(tx);
        let _ = forward.await;

        let stats = result?;
        ctx.progress(json!({
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
        }))
        .await;
        tracing::info!(job_id = %ctx.id, indexed = stats.indexed, "osm.import succeeded");
        Ok(())
    }
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

/// The actual pipeline. Cleanup runs on every exit path.
async fn execute(
    paths: &ImportPaths,
    places: &Arc<PlaceService>,
    tx: &tokio::sync::mpsc::UnboundedSender<serde_json::Value>,
    cancel: &CancellationToken,
) -> anyhow::Result<IndexStats> {
    let outcome = execute_inner(paths, places, tx, cancel).await;
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
    cancel: &CancellationToken,
) -> anyhow::Result<IndexStats> {
    // ── 1. Download (cancellable: dropping the future aborts the
    //        reqwest stream and the .part file is cleaned up below) ──
    let client = download::client()?;
    let tx_dl = tx.clone();
    let last_reported = std::sync::atomic::AtomicU64::new(0);
    // Bind the closure before building the future — the future borrows
    // it, so it must outlive the `select!` that holds the future.
    let on_progress = move |bytes: u64| {
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
    };
    let download =
        download::download_file(&client, &paths.download_url, &paths.pbf_path, &on_progress);
    tokio::select! {
        _ = cancel.cancelled() => return Err(anyhow::Error::new(Cancelled)),
        result = download => result?,
    };

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
    // Cooperative stop flag for the blocking indexer: the token is
    // pollable from sync code (`is_cancelled`), so the closure clones it.
    let stop_token = cancel.clone();
    let stop: indexer::StopFn = Arc::new(move || stop_token.is_cancelled());

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
        let join = tokio::task::spawn_blocking(move || {
            let _guard = guard; // lives for the whole closure
                                // Stale staging from a crashed run would corrupt a rebuild.
            let _ = std::fs::remove_dir_all(&staging);
            let opts = IndexOptions {
                progress: Some(progress),
                stop: Some(stop),
                ..IndexOptions::default()
            };
            let stats = indexer::run_index(&pbf, &staging, &opts)?;
            swap_index_dirs(&live, &staging)?;
            Ok::<_, anyhow::Error>(stats)
        });
        // The async side exits immediately on cancel; the blocking body
        // notices the same token at its stop checks and winds down on
        // its own (its guard keeps single-flight honest until then).
        tokio::select! {
            _ = cancel.cancelled() => return Err(anyhow::Error::new(Cancelled)),
            result = join => result
                .map_err(|e| anyhow::anyhow!("indexing task join error: {e}"))??,
        }
    };

    // ── 4. Activate the new index on the running server ─────────
    if cancel.is_cancelled() {
        // The index was built and published — activating it is fast, but
        // a cancellation that raced the swap should still win.
        return Err(anyhow::Error::new(Cancelled));
    }
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
        assert!(
            ImportGuard::acquire().is_some(),
            "guard must be reusable after drop"
        );
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
    use crate::store::CompositeStore;
    use crate::worker::RunObserver;
    use parking_lot::Mutex;
    use uuid::Uuid;

    #[derive(Default)]
    struct Progress(Mutex<Vec<serde_json::Value>>);

    #[async_trait]
    impl RunObserver for Progress {
        async fn started(&self, _: Uuid, _: &str, _: u32) {}
        async fn progressed(&self, _: Uuid, detail: &serde_json::Value) {
            self.0.lock().push(detail.clone());
        }
        async fn finished(&self, _: Uuid, _: &str, _: &crate::worker::RunOutcome) {}
    }

    /// Unreachable download URL → the attempt fails with a download
    /// error after reporting progress, and nothing is left on disk.
    #[tokio::test]
    async fn failed_download_errors_and_cleans_up() {
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
        let store = CompositeStore::in_memory().await;
        let deps = JobDeps {
            places: Arc::new(PlaceService::new(store.clone())),
            campaigns: store.campaign_store(),
            config,
        };
        let progress = Arc::new(Progress::default());
        let ctx = JobContext::for_test(progress.clone());

        let err = OsmImport::new(&deps).perform(&ctx, ()).await.unwrap_err();
        let text = err.to_string().to_lowercase();
        assert!(
            text.contains("download") || text.contains("os error") || text.contains("request"),
            "unexpected error: {err}"
        );
        let reported = progress.0.lock().clone();
        assert_eq!(reported[0]["phase"], "downloading");

        assert!(!tmp.path().join("vn.osm.pbf").exists());
        assert!(!tmp.path().join("vn.osm.pbf.part").exists());
        assert!(!tmp.path().join("osm-index.staging").exists());
    }
}
