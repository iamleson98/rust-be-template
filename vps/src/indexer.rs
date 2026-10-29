//! The OSM refresh: Geofabrik extract → places → a new in-memory index,
//! swapped in only once it has proved itself.
//!
//! Cheap when nothing changed, gentle when something did:
//! 1. fetch Geofabrik's 60-byte `.md5` and stop if the live index was built
//!    from that very extract (no download at all);
//! 2. stream the extract to `work/`, hashing as it arrives;
//! 3. extract places in a child process at the lowest CPU and I/O priority,
//!    one core, ~300 MB (`place-extract`'s first-node centroids) — search
//!    keeps the other core and its latency;
//!    In the same child, prepare the places (provinces, duplicates), so
//!    the grouping of ~460k raw rows never touches the server's heap;
//! 4. delete the extract and build the new index on a low-priority thread;
//! 5. refuse it if it is too small, shrank too much, or fails the smoke
//!    queries; otherwise publish it, swap it in, and delete old generations.
//!
//! `work/` is emptied before and after every run, success or not.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use chrono::Utc;
use futures_util::StreamExt;
use md5::{Digest, Md5};
use place_extract::{prepare, RawPlace};
use tokio::io::AsyncWriteExt;
use tracing::{info, warn};

use crate::metrics::{self, children_usage};
use crate::places::{text, Engine, SearchOptions};
use crate::state::{AppState, IndexRun};
use crate::store::{self, Manifest};

/// The extractor gets this long before it is killed.
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(45 * 60);

/// Queries a healthy Vietnam index must answer: (query, wanted kinds, the
/// top-3 hit's folded name must contain this).
const SMOKE: &[(&str, &[&str], &str)] = &[
    ("ha noi", &["city", "province"], "ha noi"),
    ("ho chi minh", &["city", "province"], "ho chi minh"),
    ("da nang", &["city", "province"], "da nang"),
    ("hai phong", &["city", "province"], "hai phong"),
    ("can tho", &["city", "province"], "can tho"),
    ("da lat", &["city", "town"], "da lat"),
    ("ben xe mien dong", &["bus_station"], "mien dong"),
    ("san bay tan son nhat", &["airport"], "tan son nhat"),
    ("ga sai gon", &["rail_station"], "sai gon"),
];

pub enum Source {
    /// Download from `indexer.pbf_url` (the scheduled run).
    Remote { force: bool },
    /// A file already on disk (tests, a manual rebuild). Never deleted.
    Local(PathBuf),
}

/// Loads the published index at start-up, if there is one.
pub fn load_current(state: &AppState) -> Result<()> {
    let Some(manifest) = state.store.current()? else {
        info!("no index yet: the first run will build one");
        return Ok(());
    };
    let started = Instant::now();
    let records = state.store.load_records(&manifest)?;
    let engine = Engine::build(records, manifest.built_at.clone());
    info!(
        "loaded index {} ({} places) in {:.1}s",
        manifest.generation,
        engine.len(),
        started.elapsed().as_secs_f64()
    );
    state.engine.store(Some(Arc::new(engine)));
    state.index.lock().unwrap().current = Some(manifest);
    Ok(())
}

/// Runs one refresh unless one is already running. Returns `false` when busy.
pub async fn run(state: Arc<AppState>, source: Source) -> Result<bool> {
    {
        let mut index = state.index.lock().unwrap();
        if index.running {
            return Ok(false);
        }
        index.running = true;
    }
    let started_at = Utc::now();
    let mut report = Report::default();
    let result = refresh(&state, source, &mut report).await;
    if let Err(e) = state.store.clean_work() {
        warn!("could not empty the work directory: {e:#}");
    }
    let (outcome, detail) = match &result {
        Ok(Some(manifest)) => ("updated", format!("generation {}", manifest.generation)),
        Ok(None) => (
            "unchanged",
            "the extract has not changed since the live index".into(),
        ),
        Err(e) => ("failed", format!("{e:#}")),
    };
    match &result {
        Ok(_) => info!("index run {outcome}: {detail}"),
        Err(_) => warn!("index run failed: {detail}"),
    }
    let mut index = state.index.lock().unwrap();
    index.running = false;
    if let Ok(Some(manifest)) = &result {
        index.current = Some(manifest.clone());
    }
    index.last_run = Some(IndexRun {
        started_at,
        finished_at: Utc::now(),
        outcome,
        detail,
        phases_ms: report.phases,
        places: report.places,
        dropped: report.dropped,
        download_bytes: report.download_bytes,
        extractor_cpu_secs: report.extractor.map(|u| u.cpu_secs),
        extractor_peak_rss_bytes: report.extractor.map(|u| u.max_rss_bytes),
    });
    drop(index);
    result.map(|_| true)
}

#[derive(Default)]
struct Report {
    phases: BTreeMap<&'static str, u64>,
    places: Option<usize>,
    dropped: Option<usize>,
    download_bytes: Option<u64>,
    extractor: Option<metrics::ChildUsage>,
}

impl Report {
    fn phase(&mut self, name: &'static str, since: Instant) {
        self.phases.insert(name, since.elapsed().as_millis() as u64);
    }
}

async fn refresh(
    state: &Arc<AppState>,
    source: Source,
    report: &mut Report,
) -> Result<Option<Manifest>> {
    let cfg = &state.config.indexer;
    state.store.clean_work()?;
    let work = state.store.work_dir().to_path_buf();
    let current = state.index.lock().unwrap().current.clone();

    let (pbf, source_md5, source_url) = match source {
        Source::Local(path) => {
            let t = Instant::now();
            let md5 = file_md5(&path).await?;
            report.phase("hash", t);
            (path.clone(), md5, path.display().to_string())
        }
        Source::Remote { force } => {
            let t = Instant::now();
            let published = published_md5(state).await?;
            report.phase("check", t);
            if !force && current.as_ref().is_some_and(|c| c.source_md5 == published) {
                return Ok(None);
            }
            let t = Instant::now();
            let path = work.join("extract.osm.pbf");
            report.download_bytes = Some(download(state, &path, &published).await?);
            report.phase("download", t);
            (path, published, cfg.pbf_url.clone())
        }
    };
    let downloaded = pbf.starts_with(&work);

    let t = Instant::now();
    let records_path = work.join("places.ndjson");
    let before = children_usage();
    let extracted =
        extract_in_child(&pbf, &records_path, &work.join("scratch"), &cfg.profile).await;
    let after = children_usage();
    report.extractor = Some(metrics::ChildUsage {
        cpu_secs: after.cpu_secs - before.cpu_secs,
        max_rss_bytes: after.max_rss_bytes,
    });
    // The extract is only needed by the extractor.
    if downloaded {
        let _ = tokio::fs::remove_file(&pbf).await;
    }
    report.dropped = Some(extracted?);
    report.phase("extract", t);

    // Build on a dedicated low-priority thread: only the finished place list
    // ever enters this process.
    let t = Instant::now();
    let generation = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let built_at = Utc::now().to_rfc3339();
    let engine = on_low_priority_thread({
        let records_path = records_path.clone();
        let built_at = built_at.clone();
        move || -> Result<Engine> {
            let records = store::read_records(&records_path)?;
            let _ = std::fs::remove_file(&records_path);
            Ok(Engine::build(records, built_at))
        }
    })
    .await?;
    report.phase("build", t);
    report.places = Some(engine.len());

    validate(
        &engine,
        engine.len(),
        current.as_ref(),
        cfg.min_places,
        cfg.max_shrink,
    )?;

    let t = Instant::now();
    let manifest = Manifest {
        generation,
        places: engine.len(),
        built_at,
        source_url,
        source_md5,
        profile: cfg.profile.clone(),
    };
    let engine = Arc::new(engine);
    let store = state.store.clone();
    let keep = cfg.keep_generations;
    let (to_publish, built) = (manifest.clone(), engine.clone());
    tokio::task::spawn_blocking(move || store.publish(&to_publish, built.records(), keep))
        .await??;
    state.engine.store(Some(engine));
    report.phase("publish", t);
    // The build's scratch memory is free now; hand it back to the system.
    metrics::release_free_memory();
    Ok(Some(manifest))
}

/// Refuses an index that is too small, shrank too much, or answers the
/// smoke queries wrongly: the live index keeps serving instead.
fn validate(
    engine: &Engine,
    places: usize,
    current: Option<&Manifest>,
    min_places: usize,
    max_shrink: f64,
) -> Result<()> {
    if places < min_places {
        bail!("only {places} places (minimum {min_places}): not publishing");
    }
    if let Some(current) = current {
        let floor = (current.places as f64 * (1.0 - max_shrink)) as usize;
        if places < floor {
            bail!(
                "{places} places, down from {} (more than {:.0}% lost): not publishing",
                current.places,
                max_shrink * 100.0
            );
        }
    }
    let failed: Vec<&str> = SMOKE
        .iter()
        .filter(|(query, kinds, name)| {
            !engine
                .search(
                    query,
                    &SearchOptions {
                        limit: 3,
                        near: None,
                    },
                )
                .iter()
                .any(|h| kinds.contains(&h.kind.as_str()) && text::fold(&h.name).contains(name))
        })
        .map(|(query, _, _)| *query)
        .collect();
    if !failed.is_empty() {
        bail!("smoke queries failed: {failed:?}: not publishing");
    }
    Ok(())
}

/// Geofabrik publishes `<extract>.md5` ("<hex>  <file name>") next to every extract.
async fn published_md5(state: &AppState) -> Result<String> {
    let url = format!("{}.md5", state.config.indexer.pbf_url);
    let body = state
        .http
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    let md5 = body
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_lowercase();
    if md5.len() != 32 || !md5.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("{url} did not return an MD5");
    }
    Ok(md5)
}

/// Streams the extract to disk, checking size and MD5. Returns the byte count.
async fn download(state: &AppState, path: &Path, expected_md5: &str) -> Result<u64> {
    let cfg = &state.config.indexer;
    let res = state
        .http
        .get(&cfg.pbf_url)
        .timeout(Duration::from_secs(30 * 60))
        .send()
        .await?
        .error_for_status()?;
    let mut file = tokio::fs::File::create(path)
        .await
        .with_context(|| format!("create {}", path.display()))?;
    let mut hasher = Md5::new();
    let mut bytes = 0u64;
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        bytes += chunk.len() as u64;
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    if bytes < cfg.min_pbf_bytes {
        bail!("downloaded only {bytes} bytes: an error page, not the extract");
    }
    let got = hex::encode(hasher.finalize());
    if got != expected_md5 {
        bail!("MD5 mismatch: got {got}, Geofabrik says {expected_md5}");
    }
    Ok(bytes)
}

async fn file_md5(path: &Path) -> Result<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<String> {
        use std::io::Read;
        let mut file =
            std::fs::File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let mut hasher = Md5::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await?
}

/// What the `extract` subcommand prints as its last stdout line.
#[derive(serde::Serialize, serde::Deserialize)]
struct ExtractSummary {
    places: usize,
    dropped: usize,
}

/// The child process's work: OSM extract → raw rows (a scratch file) →
/// prepared places at `out`. Prints an [`ExtractSummary`] line on stdout.
pub fn extract_and_prepare(pbf: &Path, out: &Path, scratch: &Path, profile: &str) -> Result<()> {
    use clap::ValueEnum;
    // The weekly run must never slow down search: lowest CPU and I/O priority.
    metrics::lower_priority();
    let profile = place_extract::travel::Profile::from_str(profile, true)
        .map_err(|e| anyhow::anyhow!("profile {profile:?}: {e}"))?;
    let raw_path = scratch.with_extension("raw.ndjson");
    place_extract::extract(&place_extract::ExtractOptions {
        pbf: pbf.to_path_buf(),
        out: raw_path.clone(),
        tmp_dir: scratch.to_path_buf(),
        centroids: place_extract::Centroids::First,
        profile,
    })?;
    // Streamed: the raw rows are grouped as they are read, never held twice.
    let mut failed = None;
    let rows = store::ndjson_stream::<RawPlace>(&raw_path)?
        .map_while(|row| row.map_err(|e| failed = Some(e)).ok());
    let prepared = prepare(rows);
    let _ = std::fs::remove_file(&raw_path);
    if let Some(e) = failed {
        return Err(e);
    }
    store::write_records(out, &prepared.records)?;
    println!(
        "{}",
        serde_json::to_string(&ExtractSummary {
            places: prepared.records.len(),
            dropped: prepared.dropped,
        })?
    );
    Ok(())
}

/// Runs `vps-service extract …` (this same binary) and waits for it. A child
/// process keeps the extractor's memory out of the server's heap, lets the
/// kernel reclaim all of it at exit, and is killed cleanly on timeout.
/// Returns how many raw rows the preparation dropped.
async fn extract_in_child(pbf: &Path, out: &Path, scratch: &Path, profile: &str) -> Result<usize> {
    let exe = std::env::current_exe().context("locate own executable")?;
    let mut child = tokio::process::Command::new(exe)
        .arg("extract")
        .arg(pbf)
        .arg("--out")
        .arg(out)
        .arg("--tmp-dir")
        .arg(scratch)
        .arg("--profile")
        .arg(profile)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("start the extractor")?;
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let mut printed = String::new();
    let waited = tokio::time::timeout(EXTRACT_TIMEOUT, async {
        use tokio::io::AsyncReadExt;
        stdout.read_to_string(&mut printed).await?;
        child.wait().await
    })
    .await;
    let status = match waited {
        Ok(status) => status?,
        Err(_) => {
            let _ = child.kill().await;
            bail!("the extractor ran longer than {EXTRACT_TIMEOUT:?} and was stopped");
        }
    };
    if !status.success() {
        bail!("the extractor failed ({status}); its log is in the service journal");
    }
    let summary: ExtractSummary = printed
        .lines()
        .last()
        .and_then(|l| serde_json::from_str(l).ok())
        .context("the extractor printed no summary")?;
    Ok(summary.dropped)
}

async fn on_low_priority_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::Builder::new()
        .name("index-build".into())
        .spawn(move || {
            metrics::lower_priority();
            let _ = tx.send(work());
        })
        .context("start the index build thread")?;
    rx.await.context("the index build thread panicked")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use place_extract::PlaceRecord;

    fn rec(id: &str, name: &str, kind: &str, lat: f64, lon: f64) -> PlaceRecord {
        PlaceRecord {
            id: id.into(),
            name: name.into(),
            kind: kind.into(),
            province: "Hà Nội".into(),
            district: String::new(),
            ward: String::new(),
            lat,
            lon,
            population: 0,
            alt_names: Vec::new(),
        }
    }

    fn manifest(places: usize) -> Manifest {
        Manifest {
            generation: "g".into(),
            places,
            built_at: "t".into(),
            source_url: "u".into(),
            source_md5: "m".into(),
            profile: "all".into(),
        }
    }

    #[test]
    fn refuses_small_shrunken_or_wrong_indexes() {
        let engine = Engine::build(vec![rec("n1", "Hà Nội", "city", 21.0, 105.8)], "t");
        let err = validate(&engine, 10, None, 15_000, 0.2).unwrap_err();
        assert!(err.to_string().contains("only 10 places"));
        let err = validate(&engine, 20_000, Some(&manifest(30_000)), 15_000, 0.2).unwrap_err();
        assert!(err.to_string().contains("down from 30000"));
        // Big enough, but it cannot answer "hồ chí minh".
        let err = validate(&engine, 20_000, Some(&manifest(21_000)), 15_000, 0.2).unwrap_err();
        assert!(err.to_string().contains("smoke queries failed"));
        assert!(err.to_string().contains("ho chi minh"));
    }
}
