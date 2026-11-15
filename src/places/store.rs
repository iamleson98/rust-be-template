//! The generation store: what `places-build` publishes and the server loads.
//!
//! ```text
//! <PLACES_DIR>/gen-<ts>/records.bin   the prepared places, one binary file
//! <PLACES_DIR>/gen-<ts>/manifest.json where the generation came from
//! <PLACES_DIR>/current                symlink to the live gen-<ts>
//! <PLACES_DIR>/work/                  scratch of a build; emptied before and after
//! ```
//!
//! A generation is written to `gen-<ts>.partial`, renamed into place and only
//! then made live by replacing the `current` symlink (a rename, so a reader
//! sees the old generation or the new one, never a mixture). The newest
//! `keep` generations survive a publish, the live one always among them.
//!
//! `records.bin` layout (little endian): the magic, a `u32` record count, then
//! per record the strings `id name kind province district ward` (`u32` byte
//! length + UTF-8), `lat` and `lon` (`f64`), `population` (`i64`) and the
//! alternative names (`u32` count, then strings). The file must end exactly
//! after the last record.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{bail, ensure, Context, Result};
use place_extract::PlaceRecord;
use serde::{Deserialize, Serialize};
use tracing::info;

const MAGIC: &[u8; 8] = b"DXPLACE1";
const RECORDS_FILE: &str = "records.bin";
const MANIFEST_FILE: &str = "manifest.json";
const CURRENT_LINK: &str = "current";
const GENERATION_PREFIX: &str = "gen-";
const PARTIAL_SUFFIX: &str = ".partial";

/// No place name is anywhere near this long: a bigger length is a corrupt file.
const MAX_STRING_BYTES: usize = 64 * 1024;
const MAX_ALT_NAMES: usize = 1024;

/// What `manifest.json` says about a generation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// UTC timestamp, `20261115T033000Z`: lexical order is age order.
    pub generation: String,
    pub places: usize,
    pub built_at: String,
    pub source_url: String,
    /// Geofabrik's MD5 of the extract the generation was built from.
    pub source_md5: String,
    pub profile: String,
}

#[derive(Debug, Clone)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Store {
        Store { root: root.into() }
    }

    pub fn work_dir(&self) -> PathBuf {
        self.root.join("work")
    }

    fn generation_dir(&self, generation: &str) -> PathBuf {
        self.root.join(format!("{GENERATION_PREFIX}{generation}"))
    }

    /// Takes the build lock: `None` while another `places-build` holds it. The
    /// lock lives as long as the returned file.
    pub fn lock_build(&self) -> Result<Option<File>> {
        fs::create_dir_all(&self.root)
            .with_context(|| format!("create {}", self.root.display()))?;
        let path = self.root.join(".lock");
        let file = File::create(&path).with_context(|| format!("create {}", path.display()))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(file)),
            Err(std::fs::TryLockError::WouldBlock) => Ok(None),
            Err(std::fs::TryLockError::Error(e)) => {
                Err(e).with_context(|| format!("lock {}", path.display()))
            }
        }
    }

    /// Empties the scratch directory and removes what a crashed publish left.
    pub fn clean_work(&self) -> Result<()> {
        let work = self.work_dir();
        if work.exists() {
            fs::remove_dir_all(&work).with_context(|| format!("remove {}", work.display()))?;
        }
        fs::create_dir_all(&work).with_context(|| format!("create {}", work.display()))?;
        for entry in fs::read_dir(&self.root)? {
            let path = entry?.path();
            if path.to_string_lossy().ends_with(PARTIAL_SUFFIX) {
                fs::remove_dir_all(&path)
                    .with_context(|| format!("remove partial {}", path.display()))?;
            }
        }
        Ok(())
    }

    /// The generation the `current` link points at (`None` before the first publish).
    pub fn current_generation(&self) -> Result<Option<String>> {
        let link = self.root.join(CURRENT_LINK);
        let target = match fs::read_link(&link) {
            Ok(target) => target,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e).with_context(|| format!("read link {}", link.display())),
        };
        let generation = target
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_prefix(GENERATION_PREFIX))
            .with_context(|| format!("{} points at {}", link.display(), target.display()))?;
        Ok(Some(generation.to_string()))
    }

    pub fn manifest(&self, generation: &str) -> Result<Manifest> {
        let path = self.generation_dir(generation).join(MANIFEST_FILE);
        serde_json::from_slice(
            &fs::read(&path).with_context(|| format!("read {}", path.display()))?,
        )
        .with_context(|| format!("parse {}", path.display()))
    }

    pub fn current_manifest(&self) -> Result<Option<Manifest>> {
        self.current_generation()?
            .map(|generation| self.manifest(&generation))
            .transpose()
    }

    /// The manifest and the places of a generation.
    pub fn load(&self, generation: &str) -> Result<(Manifest, Vec<PlaceRecord>)> {
        let manifest = self.manifest(generation)?;
        let records = read_records(&self.generation_dir(generation).join(RECORDS_FILE))?;
        ensure!(
            records.len() == manifest.places,
            "generation {generation} holds {} places, its manifest says {}",
            records.len(),
            manifest.places
        );
        Ok((manifest, records))
    }

    /// Writes a generation, makes it live and deletes generations beyond `keep`.
    pub fn publish(&self, manifest: &Manifest, records: &[PlaceRecord], keep: usize) -> Result<()> {
        let dir = self.generation_dir(&manifest.generation);
        let partial = PathBuf::from(format!("{}{PARTIAL_SUFFIX}", dir.display()));
        if partial.exists() {
            fs::remove_dir_all(&partial)?;
        }
        fs::create_dir_all(&partial).with_context(|| format!("create {}", partial.display()))?;
        write_records(&partial.join(RECORDS_FILE), records)?;
        write_synced(&partial.join(MANIFEST_FILE), |out| {
            serde_json::to_writer_pretty(out, manifest)?;
            Ok(())
        })?;
        sync_dir(&partial)?;
        fs::rename(&partial, &dir)
            .with_context(|| format!("rename {} -> {}", partial.display(), dir.display()))?;
        sync_dir(&self.root)?;
        self.point_current_at(&manifest.generation)?;
        self.prune(&manifest.generation, keep)
    }

    fn point_current_at(&self, generation: &str) -> Result<()> {
        let staged = self.root.join("current.new");
        match fs::remove_file(&staged) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e).with_context(|| format!("remove {}", staged.display())),
        }
        std::os::unix::fs::symlink(format!("{GENERATION_PREFIX}{generation}"), &staged)
            .with_context(|| format!("create {}", staged.display()))?;
        let link = self.root.join(CURRENT_LINK);
        fs::rename(&staged, &link)
            .with_context(|| format!("rename {} -> {}", staged.display(), link.display()))?;
        sync_dir(&self.root)
    }

    /// Published generations, newest first.
    fn generations(&self) -> Result<Vec<String>> {
        let mut found: Vec<String> = fs::read_dir(&self.root)?
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                let generation = name.strip_prefix(GENERATION_PREFIX)?;
                (!generation.ends_with(PARTIAL_SUFFIX)).then(|| generation.to_string())
            })
            .collect();
        found.sort_unstable_by(|a, b| b.cmp(a));
        Ok(found)
    }

    /// Keeps the newest `keep` generations, `live` always among them.
    fn prune(&self, live: &str, keep: usize) -> Result<()> {
        let mut kept = 0;
        for generation in self.generations()? {
            if generation == live || kept < keep.saturating_sub(1) {
                if generation != live {
                    kept += 1;
                }
                continue;
            }
            let dir = self.generation_dir(&generation);
            info!("removing old place generation {}", dir.display());
            fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
        }
        Ok(())
    }
}

/// Flushes a directory's entries (a rename is only durable once its parent
/// directory is synced), so a power cut cannot lose the generation the
/// `current` link already points at.
fn sync_dir(dir: &Path) -> Result<()> {
    File::open(dir)
        .and_then(|d| d.sync_all())
        .with_context(|| format!("sync {}", dir.display()))
}

fn write_synced(path: &Path, write: impl FnOnce(&mut BufWriter<File>) -> Result<()>) -> Result<()> {
    let file = File::create(path).with_context(|| format!("create {}", path.display()))?;
    let mut out = BufWriter::new(file);
    write(&mut out)?;
    out.into_inner()
        .map_err(|e| e.into_error())?
        .sync_all()
        .with_context(|| format!("sync {}", path.display()))
}

fn write_records(path: &Path, records: &[PlaceRecord]) -> Result<()> {
    write_synced(path, |out| {
        out.write_all(MAGIC)?;
        out.write_all(&u32::try_from(records.len())?.to_le_bytes())?;
        for rec in records {
            for s in [
                &rec.id,
                &rec.name,
                &rec.kind,
                &rec.province,
                &rec.district,
                &rec.ward,
            ] {
                write_str(out, s)?;
            }
            out.write_all(&rec.lat.to_le_bytes())?;
            out.write_all(&rec.lon.to_le_bytes())?;
            out.write_all(&rec.population.to_le_bytes())?;
            out.write_all(&u32::try_from(rec.alt_names.len())?.to_le_bytes())?;
            for alt in &rec.alt_names {
                write_str(out, alt)?;
            }
        }
        Ok(())
    })
}

fn write_str(out: &mut impl Write, s: &str) -> Result<()> {
    ensure!(
        s.len() <= MAX_STRING_BYTES,
        "a place string is {} bytes long",
        s.len()
    );
    out.write_all(&(s.len() as u32).to_le_bytes())?;
    out.write_all(s.as_bytes())?;
    Ok(())
}

fn read_records(path: &Path) -> Result<Vec<PlaceRecord>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut input = BufReader::new(file);
    let mut magic = [0u8; 8];
    input.read_exact(&mut magic).context("read the header")?;
    ensure!(
        &magic == MAGIC,
        "{} is not a place records file",
        path.display()
    );
    let count = read_u32(&mut input)? as usize;
    // Every record is at least 52 bytes: a count the file cannot hold is corrupt.
    let size = input.get_ref().metadata()?.len() as usize;
    ensure!(
        count <= size / 52,
        "{} claims {count} records",
        path.display()
    );
    let mut records = Vec::with_capacity(count);
    for n in 0..count {
        records.push(
            read_record(&mut input).with_context(|| format!("{} record {n}", path.display()))?,
        );
    }
    ensure!(
        input.read(&mut [0u8; 1])? == 0,
        "{} has data after its last record",
        path.display()
    );
    Ok(records)
}

fn read_record(input: &mut impl Read) -> Result<PlaceRecord> {
    let id = read_str(input)?;
    let name = read_str(input)?;
    let kind = read_str(input)?;
    let province = read_str(input)?;
    let district = read_str(input)?;
    let ward = read_str(input)?;
    let lat = read_f64(input)?;
    let lon = read_f64(input)?;
    let population = read_i64(input)?;
    let alts = read_u32(input)? as usize;
    if alts > MAX_ALT_NAMES {
        bail!("{alts} alternative names");
    }
    let alt_names = (0..alts)
        .map(|_| read_str(input))
        .collect::<Result<Vec<_>>>()?;
    Ok(PlaceRecord {
        id,
        name,
        kind,
        province,
        district,
        ward,
        lat,
        lon,
        population,
        alt_names,
    })
}

fn read_u32(input: &mut impl Read) -> Result<u32> {
    let mut buf = [0u8; 4];
    input.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_f64(input: &mut impl Read) -> Result<f64> {
    let mut buf = [0u8; 8];
    input.read_exact(&mut buf)?;
    Ok(f64::from_le_bytes(buf))
}

fn read_i64(input: &mut impl Read) -> Result<i64> {
    let mut buf = [0u8; 8];
    input.read_exact(&mut buf)?;
    Ok(i64::from_le_bytes(buf))
}

fn read_str(input: &mut impl Read) -> Result<String> {
    let len = read_u32(input)? as usize;
    ensure!(len <= MAX_STRING_BYTES, "a string of {len} bytes");
    let mut buf = vec![0u8; len];
    input.read_exact(&mut buf)?;
    Ok(String::from_utf8(buf)?)
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
        PlaceRecord {
            id: id.into(),
            name: "Hà Nội".into(),
            kind: "city".into(),
            province: "Hà Nội".into(),
            district: String::new(),
            ward: "Phường Cầu Giấy".into(),
            lat: 21.0285,
            lon: 105.8542,
            population: 8_000_000,
            alt_names: vec!["Thăng Long".into(), "Hanoi".into()],
        }
    }

    #[test]
    fn publishes_loads_and_keeps_only_recent_generations() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        assert_eq!(store.current_generation().unwrap(), None);
        for (i, generation) in ["20261001T000000Z", "20261008T000000Z", "20261015T000000Z"]
            .iter()
            .enumerate()
        {
            let records: Vec<PlaceRecord> = (0..=i).map(|j| record(&format!("n{j}"))).collect();
            store
                .publish(&manifest(generation, records.len()), &records, 2)
                .unwrap();
        }
        assert_eq!(
            store.current_generation().unwrap().as_deref(),
            Some("20261015T000000Z")
        );
        let (manifest, records) = store.load("20261015T000000Z").unwrap();
        assert_eq!(manifest.places, 3);
        assert_eq!(records[2], record("n2"));
        assert_eq!(
            store.current_manifest().unwrap().unwrap().generation,
            "20261015T000000Z"
        );
        let mut entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n != ".lock")
            .collect();
        entries.sort();
        assert_eq!(
            entries,
            ["current", "gen-20261008T000000Z", "gen-20261015T000000Z"]
        );
    }

    #[test]
    fn directories_can_be_synced_after_renames() {
        let dir = tempfile::tempdir().unwrap();
        sync_dir(dir.path()).unwrap();
        let err = sync_dir(&dir.path().join("missing")).unwrap_err();
        assert!(format!("{err:#}").contains("sync "), "{err:#}");
    }

    #[test]
    fn a_live_generation_survives_pruning_even_when_it_is_not_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let generations = ["20261001T000000Z", "20261008T000000Z", "20261015T000000Z"];
        for generation in generations {
            store
                .publish(&manifest(generation, 1), &[record("n1")], 3)
                .unwrap();
        }
        // A rollback: the oldest generation is live again.
        store.point_current_at(generations[0]).unwrap();
        store.prune(generations[0], 2).unwrap();
        assert_eq!(
            store.generations().unwrap(),
            [generations[2], generations[0]],
            "the newest one and the live one"
        );
    }

    #[test]
    fn refuses_truncated_corrupt_and_mismatched_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let records = [record("n1"), record("n2")];
        store
            .publish(&manifest("20261001T000000Z", 2), &records, 2)
            .unwrap();
        let file = dir.path().join("gen-20261001T000000Z").join(RECORDS_FILE);
        let bytes = fs::read(&file).unwrap();

        fs::write(&file, &bytes[..bytes.len() - 3]).unwrap();
        assert!(store.load("20261001T000000Z").is_err(), "truncated");

        let mut trailing = bytes.clone();
        trailing.push(0);
        fs::write(&file, &trailing).unwrap();
        assert!(store.load("20261001T000000Z").is_err(), "trailing data");

        let mut wrong_magic = bytes.clone();
        wrong_magic[0] = b'X';
        fs::write(&file, &wrong_magic).unwrap();
        assert!(store.load("20261001T000000Z").is_err(), "magic");

        fs::write(&file, &bytes).unwrap();
        let mut one_record = bytes.clone();
        one_record[8..12].copy_from_slice(&1u32.to_le_bytes());
        fs::write(&file, &one_record).unwrap();
        assert!(store.load("20261001T000000Z").is_err(), "count");

        fs::write(&file, &bytes).unwrap();
        assert_eq!(store.load("20261001T000000Z").unwrap().1, records);
    }

    #[test]
    fn the_build_lock_is_exclusive_and_a_crash_leaves_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        let held = store.lock_build().unwrap().expect("first lock");
        assert!(
            store.lock_build().unwrap().is_none(),
            "second lock is refused"
        );
        drop(held);
        assert!(store.lock_build().unwrap().is_some());

        fs::create_dir_all(store.work_dir()).unwrap();
        fs::write(store.work_dir().join("extract.osm.pbf"), b"x").unwrap();
        fs::create_dir(dir.path().join("gen-20261015T000000Z.partial")).unwrap();
        store.clean_work().unwrap();
        assert_eq!(fs::read_dir(store.work_dir()).unwrap().count(), 0);
        assert!(!dir.path().join("gen-20261015T000000Z.partial").exists());
    }
}
