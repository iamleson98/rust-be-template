//! On-disk state under `data_dir`:
//!
//! ```text
//! index/current.json          which generation is live, and where it came from
//! index/<generation>.ndjson   one prepared place per line (PlaceRecord arrays)
//! work/                       scratch for an index run; emptied before and after every run
//! ```
//!
//! Only `keep_generations` index files survive a publish, the OSM download
//! and the extractor's output never outlive their run, and anything a crash
//! left behind is removed on start-up.

use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use place_extract::PlaceRecord;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// What `index/current.json` says about the live index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub generation: String,
    pub places: usize,
    pub built_at: String,
    pub source_url: String,
    /// Geofabrik's MD5 of the extract this index was built from.
    pub source_md5: String,
    pub profile: String,
}

#[derive(Debug, Clone)]
pub struct Store {
    index_dir: PathBuf,
    work_dir: PathBuf,
}

impl Store {
    pub fn open(data_dir: &Path) -> Result<Store> {
        let store = Store {
            index_dir: data_dir.join("index"),
            work_dir: data_dir.join("work"),
        };
        std::fs::create_dir_all(&store.index_dir)
            .with_context(|| format!("create {}", store.index_dir.display()))?;
        store.clean_work()?;
        store.remove_partial_files()?;
        Ok(store)
    }

    pub fn work_dir(&self) -> &Path {
        &self.work_dir
    }

    #[cfg(test)]
    pub fn index_dir(&self) -> &Path {
        &self.index_dir
    }

    /// Empties the scratch directory (an interrupted run's download and
    /// extractor output included).
    pub fn clean_work(&self) -> Result<()> {
        if self.work_dir.exists() {
            std::fs::remove_dir_all(&self.work_dir)
                .with_context(|| format!("remove {}", self.work_dir.display()))?;
        }
        std::fs::create_dir_all(&self.work_dir)
            .with_context(|| format!("create {}", self.work_dir.display()))?;
        Ok(())
    }

    /// Half-written files of a publish that crashed.
    fn remove_partial_files(&self) -> Result<()> {
        for entry in std::fs::read_dir(&self.index_dir)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "tmp") {
                warn!("removing partial file {}", path.display());
                std::fs::remove_file(&path)?;
            }
        }
        Ok(())
    }

    pub fn current(&self) -> Result<Option<Manifest>> {
        let path = self.index_dir.join("current.json");
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(
                serde_json::from_slice(&bytes)
                    .with_context(|| format!("parse {}", path.display()))?,
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
        }
    }

    fn generation_path(&self, generation: &str) -> PathBuf {
        self.index_dir.join(format!("{generation}.ndjson"))
    }

    pub fn load_records(&self, manifest: &Manifest) -> Result<Vec<PlaceRecord>> {
        read_records(&self.generation_path(&manifest.generation))
    }

    /// Writes a generation, then flips `current.json` to it (each through a
    /// rename, so a crash leaves either the old index or the new one), then
    /// deletes generations beyond `keep`.
    pub fn publish(&self, manifest: &Manifest, records: &[PlaceRecord], keep: usize) -> Result<()> {
        write_records(&self.generation_path(&manifest.generation), records)?;
        write_atomically(&self.index_dir.join("current.json"), |out| {
            serde_json::to_writer_pretty(&mut *out, manifest)?;
            Ok(())
        })?;
        self.prune(&manifest.generation, keep)
    }

    /// Keeps the newest `keep` generations, always including `live`.
    pub fn prune(&self, live: &str, keep: usize) -> Result<()> {
        let mut generations: Vec<String> = std::fs::read_dir(&self.index_dir)?
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                name.strip_suffix(".ndjson").map(str::to_string)
            })
            .collect();
        // Generation names are UTC timestamps: lexical order is age order.
        generations.sort_unstable_by(|a, b| b.cmp(a));
        let mut kept = 0;
        for generation in generations {
            if generation == live || kept < keep.saturating_sub(1) {
                if generation != live {
                    kept += 1;
                }
                continue;
            }
            let path = self.generation_path(&generation);
            info!("removing old index generation {}", path.display());
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Bytes used under the index directory (the work directory is empty between runs).
    pub fn index_bytes(&self) -> u64 {
        dir_bytes(&self.index_dir) + dir_bytes(&self.work_dir)
    }
}

fn dir_bytes(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_bytes(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Writes one record per line, atomically.
pub fn write_records(path: &Path, records: &[PlaceRecord]) -> Result<()> {
    write_atomically(path, |out| {
        for rec in records {
            serde_json::to_writer(&mut *out, rec)?;
            out.write_all(b"\n")?;
        }
        Ok(())
    })
}

fn write_atomically(
    path: &Path,
    write: impl FnOnce(&mut BufWriter<std::fs::File>) -> Result<()>,
) -> Result<()> {
    let tmp = path.with_extension("tmp");
    let file = std::fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
    let mut out = BufWriter::new(file);
    write(&mut out)?;
    let file = out.into_inner().map_err(|e| e.into_error())?;
    file.sync_all()?;
    std::fs::rename(&tmp, path)
        .with_context(|| format!("rename {} -> {}", tmp.display(), path.display()))?;
    Ok(())
}

/// Streams NDJSON values, one per non-empty line.
pub fn ndjson_stream<T: serde::de::DeserializeOwned>(
    path: &Path,
) -> Result<impl Iterator<Item = Result<T>>> {
    let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let path = path.to_path_buf();
    Ok(BufReader::new(file)
        .lines()
        .enumerate()
        .filter(|(_, line)| line.as_ref().map_or(true, |l| !l.trim().is_empty()))
        .map(move |(n, line)| {
            let line = line?;
            serde_json::from_str(&line)
                .with_context(|| format!("{} line {}", path.display(), n + 1))
        }))
}

/// Reads NDJSON, one value per non-empty line.
pub fn read_ndjson<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Vec<T>> {
    let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut out = Vec::new();
    for (n, line) in BufReader::new(file).lines().enumerate() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        out.push(
            serde_json::from_str(&line)
                .with_context(|| format!("{} line {}", path.display(), n + 1))?,
        );
    }
    Ok(out)
}

pub fn read_records(path: &Path) -> Result<Vec<PlaceRecord>> {
    read_ndjson(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(generation: &str, places: usize) -> Manifest {
        Manifest {
            generation: generation.into(),
            places,
            built_at: "t".into(),
            source_url: "u".into(),
            source_md5: "m".into(),
            profile: "all".into(),
        }
    }

    fn record(id: &str) -> PlaceRecord {
        serde_json::from_str(&format!(
            r#"["{id}","Hà Nội","city","Hà Nội","","",21.0,105.8,1,""]"#
        ))
        .unwrap()
    }

    #[test]
    fn publishes_loads_and_keeps_only_recent_generations() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.current().unwrap(), None);
        for (i, generation) in ["20261001T000000Z", "20261008T000000Z", "20261015T000000Z"]
            .iter()
            .enumerate()
        {
            let m = manifest(generation, i + 1);
            let records: Vec<PlaceRecord> = (0..=i).map(|j| record(&format!("n{j}"))).collect();
            store.publish(&m, &records, 2).unwrap();
        }
        let live = store.current().unwrap().unwrap();
        assert_eq!(live.generation, "20261015T000000Z");
        assert_eq!(store.load_records(&live).unwrap().len(), 3);
        let mut files: Vec<String> = std::fs::read_dir(store.index_dir())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        files.sort();
        assert_eq!(
            files,
            [
                "20261008T000000Z.ndjson",
                "20261015T000000Z.ndjson",
                "current.json"
            ]
        );
    }

    #[test]
    fn start_up_removes_what_a_crash_left_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path()).unwrap();
        std::fs::write(store.work_dir().join("vietnam-latest.osm.pbf"), b"x").unwrap();
        std::fs::write(store.index_dir().join("20261015T000000Z.tmp"), b"x").unwrap();
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(std::fs::read_dir(store.work_dir()).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(store.index_dir()).unwrap().count(), 0);
    }
}
