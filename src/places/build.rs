//! `places-build` — the Geofabrik Vietnam extract → a new place generation.
//!
//! Run weekly by a systemd timer, in its own process and cgroup (`Nice=19`,
//! `IOSchedulingClass=idle`, a memory cap): the server never builds anything,
//! so the extractor's ~600 MB peak never lands in its heap. Cheap when
//! nothing changed, gentle when something did:
//!
//! 1. fetch Geofabrik's 60-byte `.md5` and stop if the live generation was
//!    built from that very extract (unless `--force`): no download at all;
//! 2. stream the extract to `work/` and check its MD5;
//! 3. extract the places (`place-extract`: provinces, duplicates) and delete
//!    the extract;
//! 4. build the engine and refuse it if it is too small, shrank too much or
//!    fails the smoke queries; otherwise publish it as a new generation.
//!
//! The server notices the new generation within a minute (see
//! [`super::live`]). `work/` is emptied before and after every run.

use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use chrono::Utc;
use clap::ValueEnum;
use md5::{Digest, Md5};
use place_extract::travel::Profile;
use place_extract::{prepare, Centroids, ExtractOptions, Prepared, RawPlace};
use tracing::{info, warn};

use super::store::{Manifest, Store};
use super::{text, Engine, SearchOptions};
use crate::config::Config;
use crate::osm::download;

/// A Vietnam index below this many places is a broken extract.
const MIN_PLACES: usize = 15_000;
/// A new generation may lose at most this share of the live one's places.
const MAX_SHRINK: f64 = 0.2;
const KEEP_GENERATIONS: usize = 2;

/// Queries a healthy Vietnam index must answer: (query, wanted kinds, the
/// folded name one of the top 3 hits must contain).
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

/// What a build needs to know.
struct Plan {
    store: Store,
    /// `travel` | `landmarks` | `full` | `all`.
    profile: String,
    pbf_url: String,
}

pub enum Outcome {
    /// Geofabrik's extract is the one the live generation was built from.
    Unchanged,
    Published(Manifest),
}

/// The `places-build` command.
pub async fn run(force: bool) -> Result<()> {
    let config = Config::load().context("loading config")?;
    let plan = Plan {
        store: Store::new(&config.places.dir),
        profile: config.places.profile.clone(),
        pbf_url: config
            .search
            .osm_download_url
            .clone()
            .unwrap_or_else(|| download::VIETNAM_PBF_URL.to_string()),
    };
    match build_generation(&plan, force).await? {
        Outcome::Unchanged => println!("unchanged: the extract is the live generation's"),
        Outcome::Published(m) => println!(
            "published generation {} ({} places, extract md5 {})",
            m.generation, m.places, m.source_md5
        ),
    }
    Ok(())
}

async fn build_generation(plan: &Plan, force: bool) -> Result<Outcome> {
    let Some(_lock) = plan.store.lock_build()? else {
        bail!("another places-build is running");
    };
    plan.store.clean_work()?;
    let result = refresh(plan, force).await;
    if let Err(e) = plan.store.clean_work() {
        warn!("could not empty the work directory: {e:#}");
    }
    result
}

async fn refresh(plan: &Plan, force: bool) -> Result<Outcome> {
    let profile = Profile::from_str(&plan.profile, true)
        .map_err(|e| anyhow::anyhow!("PLACES_PROFILE {:?}: {e}", plan.profile))?;
    let current = match plan.store.current_manifest() {
        Ok(current) => current,
        Err(e) => {
            warn!("the live generation is unreadable, building without it: {e:#}");
            None
        }
    };
    let client = download::client()?;
    let published = published_md5(&client, &plan.pbf_url).await?;
    if !force && current.as_ref().is_some_and(|c| c.source_md5 == published) {
        return Ok(Outcome::Unchanged);
    }

    let work = plan.store.work_dir();
    let pbf = work.join("extract.osm.pbf");
    let started = Instant::now();
    let bytes = download::download_file(&client, &plan.pbf_url, &pbf, &|_| {}).await?;
    let got = file_md5(&pbf).await?;
    if got != published {
        bail!("MD5 mismatch: got {got}, Geofabrik says {published}");
    }
    info!(
        bytes,
        "extract downloaded in {:.0}s",
        started.elapsed().as_secs_f64()
    );

    let started = Instant::now();
    let prepared = {
        let (pbf, work) = (pbf.clone(), work.clone());
        tokio::task::spawn_blocking(move || extract_places(&pbf, &work, profile)).await??
    };
    info!(
        places = prepared.records.len(),
        dropped = prepared.dropped,
        "places extracted in {:.0}s",
        started.elapsed().as_secs_f64()
    );

    let built_at = Utc::now();
    let generation = built_at.format("%Y%m%dT%H%M%SZ").to_string();
    let engine = {
        let built_at = built_at.to_rfc3339();
        tokio::task::spawn_blocking(move || Engine::build(prepared.records, built_at)).await?
    };
    validate(&engine, current.as_ref(), MIN_PLACES)?;

    let manifest = Manifest {
        generation,
        places: engine.len(),
        built_at: built_at.to_rfc3339(),
        source_url: plan.pbf_url.clone(),
        source_md5: published,
        profile: plan.profile.clone(),
    };
    let store = plan.store.clone();
    let to_publish = manifest.clone();
    tokio::task::spawn_blocking(move || {
        store.publish(&to_publish, engine.records(), KEEP_GENERATIONS)
    })
    .await??;
    Ok(Outcome::Published(manifest))
}

/// Refuses an index that is too small, shrank too much, or answers the smoke
/// queries wrongly: the live generation keeps serving instead.
fn validate(engine: &Engine, current: Option<&Manifest>, min_places: usize) -> Result<()> {
    let places = engine.len();
    if places < min_places {
        bail!("only {places} places (minimum {min_places}): not publishing");
    }
    if let Some(current) = current {
        let floor = (current.places as f64 * (1.0 - MAX_SHRINK)) as usize;
        if places < floor {
            bail!(
                "{places} places, down from {} (more than {:.0}% lost): not publishing",
                current.places,
                MAX_SHRINK * 100.0
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
async fn published_md5(client: &reqwest::Client, pbf_url: &str) -> Result<String> {
    let url = format!("{pbf_url}.md5");
    let body = client
        .get(&url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .with_context(|| format!("requesting {url}"))?
        .error_for_status()?
        .text()
        .await?;
    parse_md5(&body).with_context(|| format!("{url} did not return an MD5"))
}

fn parse_md5(body: &str) -> Option<String> {
    let md5 = body.split_whitespace().next()?.to_lowercase();
    (md5.len() == 32 && md5.bytes().all(|b| b.is_ascii_hexdigit())).then_some(md5)
}

async fn file_md5(path: &Path) -> Result<String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<String> {
        let mut file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
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

/// OSM extract → raw rows (a scratch file) → prepared places. The extract is
/// deleted as soon as it has been read, the raw rows are grouped as they are
/// streamed back in, so nothing is ever held twice.
fn extract_places(pbf: &Path, work: &Path, profile: Profile) -> Result<Prepared> {
    let raw: PathBuf = work.join("raw.ndjson");
    place_extract::extract(&ExtractOptions {
        pbf: pbf.to_path_buf(),
        out: raw.clone(),
        tmp_dir: work.join("scratch"),
        centroids: Centroids::First,
        profile,
    })?;
    std::fs::remove_file(pbf).with_context(|| format!("remove {}", pbf.display()))?;
    let prepared = prepare_raw(&raw);
    let _ = std::fs::remove_file(&raw);
    prepared
}

fn prepare_raw(raw: &Path) -> Result<Prepared> {
    let file = File::open(raw).with_context(|| format!("open {}", raw.display()))?;
    let mut failed = None;
    let rows = BufReader::new(file)
        .lines()
        .filter(|line| line.as_ref().map_or(true, |l| !l.trim().is_empty()))
        .map_while(|line| {
            match line
                .map_err(anyhow::Error::from)
                .and_then(|l| Ok(serde_json::from_str::<RawPlace>(&l)?))
            {
                Ok(row) => Some(row),
                Err(e) => {
                    failed = Some(e);
                    None
                }
            }
        });
    let prepared = prepare(rows);
    match failed {
        Some(e) => Err(e.context(format!("read {}", raw.display()))),
        None => Ok(prepared),
    }
}

#[cfg(test)]
mod tests {
    use place_extract::PlaceRecord;

    use super::*;

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
        let err = validate(&engine, None, 15_000).unwrap_err();
        assert!(err.to_string().contains("only 1 places"));
        let err = validate(&engine, Some(&manifest(30_000)), 1).unwrap_err();
        assert!(err.to_string().contains("down from 30000"));
        // Big enough, but it cannot answer "hồ chí minh".
        let err = validate(&engine, Some(&manifest(1)), 1).unwrap_err();
        assert!(err.to_string().contains("smoke queries failed"));
        assert!(err.to_string().contains("ho chi minh"));
    }

    #[test]
    fn accepts_an_index_that_answers_the_smoke_queries() {
        let engine = Engine::build(
            vec![
                rec("n1", "Hà Nội", "city", 21.03, 105.85),
                rec("n2", "Hồ Chí Minh", "city", 10.78, 106.7),
                rec("n3", "Đà Nẵng", "city", 16.05, 108.2),
                rec("n4", "Hải Phòng", "city", 20.86, 106.68),
                rec("n5", "Cần Thơ", "city", 10.03, 105.78),
                rec("n6", "Đà Lạt", "town", 11.94, 108.44),
                rec("n7", "Bến xe Miền Đông", "bus_station", 10.81, 106.71),
                rec("n8", "Sân bay Tân Sơn Nhất", "airport", 10.82, 106.66),
                rec("n9", "Ga Sài Gòn", "rail_station", 10.78, 106.68),
            ],
            "t",
        );
        validate(&engine, Some(&manifest(10)), 9).unwrap();
    }

    #[test]
    fn reads_geofabrik_md5_files() {
        let md5 = "0123456789abcdef0123456789ABCDEF";
        assert_eq!(
            parse_md5(&format!("{md5}  vietnam-latest.osm.pbf\n")).as_deref(),
            Some(md5.to_lowercase().as_str())
        );
        assert_eq!(parse_md5("<html>not found</html>"), None);
        assert_eq!(parse_md5(""), None);
    }

    #[tokio::test]
    async fn hashes_files_like_md5sum() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f");
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(
            file_md5(&path).await.unwrap(),
            "900150983cd24fb0d6963f7d28e17f72"
        );
    }

    #[test]
    fn raw_rows_become_prepared_places() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("raw.ndjson");
        std::fs::write(
            &path,
            concat!(
                r#"{"osmId":1,"osmType":"node","kind":"city","name":"Hà Nội","province":"Hà Nội","lat":21.03,"lon":105.85,"population":8000000}"#,
                "\n\n",
                r#"{"osmId":2,"osmType":"node","kind":"city","name":"Nowhere","province":"Phnom Penh","lat":11.5,"lon":104.9,"population":1}"#,
                "\n"
            ),
        )
        .unwrap();
        let prepared = prepare_raw(&path).unwrap();
        assert_eq!(prepared.records.len(), 1);
        assert_eq!(prepared.records[0].name, "Hà Nội");
        assert_eq!(prepared.dropped, 1, "places outside the served provinces");

        std::fs::write(&path, "{not json}\n").unwrap();
        assert!(prepare_raw(&path).is_err());
    }
}
