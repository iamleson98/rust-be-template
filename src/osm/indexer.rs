//! Index driver: multi-pass OSM ingestion with spatial hierarchy.
//!
//! Pipeline:
//! 1. **Pass 1** — discover admin relations and their way members.
//! 2. **Pass 2** — collect named nodes (→ temp file), named ways (→ temp file),
//!    admin ways (→ memory), and build the needed-node-IDs set.
//! 3. **Pass 3** — cache (lat, lon) for every needed node ID.
//! 4. **Build spatial index** — stitch admin polygons + bulk-load 3 R-trees.
//! 5. **Index nodes** from temp file.
//! 6. **Index ways** from temp file — compute LineString centroid from all
//!    cached node coords, then resolve hierarchy.
//! 7. **Index admin relations** — use MultiPolygon centroid for hierarchy.
//! 8. **Commit + merge**.

use crate::osm::osm_reader::{
    self, classify, derive_name, AdminRelationInfo, CentroidMode, NodeRecord, WayRecord,
};
use crate::osm::schema::{register_tokenizers, SCHEMA};
use crate::osm::spatial::{self, AdminHierarchy, SpatialIndex};
use crate::osm::vn_text;
use anyhow::Result;
use geo::{Centroid, Coord, LineString};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::Instant;
use tantivy::{Index, TantivyDocument};
use tracing::info;

const COMMIT_BATCH: u64 = 500_000;

/// Callback invoked at pipeline milestones and each commit batch so
/// callers (the scheduled OSM import job) can surface progress.
/// Sync — send / store from inside, don't await.
pub type ProgressFn = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

/// Controls indexing behavior — RAM/CPU/accuracy tradeoffs.
/// (No `Debug` derive: [`IndexOptions::progress`] is a trait object.)
#[derive(Clone)]
pub struct IndexOptions {
    /// Tantivy indexer heap in bytes.
    pub heap_bytes: usize,
    /// Maximum number of indexing threads. 1 = single-threaded (slowest,
    /// lowest CPU). Default: number of CPUs.
    pub max_threads: usize,
    /// How to compute way centroids. `Full` caches all way nodes (~2 GB
    /// RAM for full Vietnam) for accurate hierarchy. `FirstNode` caches
    /// only the first node (~300 MB RAM) but may mis-assign hierarchy for
    /// long streets crossing district boundaries.
    pub centroid_mode: CentroidMode,
    /// Optional progress callback (phase messages + commit counts).
    /// `None` for the CLI path.
    pub progress: Option<ProgressFn>,
}

impl Default for IndexOptions {
    fn default() -> Self {
        Self {
            // 256 MB heap — significantly less RAM than the previous 1 GB
            // default. Tantivy's indexer is a merge-sort; smaller heap =
            // more disk spills = slightly slower, but on a 2 GB VM this
            // is the difference between OOM and success.
            heap_bytes: 256 * 1024 * 1024,
            // Single-threaded by default — limits CPU usage during
            // indexing. Override via CLI `--threads N` for faster builds.
            max_threads: 1,
            // FirstNode mode — caches only the first node of each way
            // (~10-30 MB for Vietnam vs ~160 MB for Full mode).
            // Tradeoff: long streets crossing district boundaries may
            // be assigned to the wrong district. Acceptable for a bus
            // ticketing app — the hierarchy is display metadata, not
            // routing data.
            centroid_mode: CentroidMode::FirstNode,
            progress: None,
        }
    }
}

/// Emit a progress message when a callback is configured.
fn emit(opts: &IndexOptions, msg: &str) {
    if let Some(p) = &opts.progress {
        p(msg);
    }
}

/// Open an existing Tantivy index, or create one if `index_dir` is empty.
pub fn open_or_create_index(index_dir: &Path) -> Result<Index> {
    std::fs::create_dir_all(index_dir)?;
    let meta = index_dir.join("meta.json");
    let index = if meta.exists() {
        Index::open_in_dir(index_dir)?
    } else {
        Index::create_in_dir(index_dir, SCHEMA.schema.clone())?
    };
    register_tokenizers(&index);
    Ok(index)
}

/// Build a Tantivy document from a generic place record.
#[allow(clippy::too_many_arguments)]
fn build_doc(
    id: i64,
    osm_type: &str,
    place_kind: &str,
    admin_level: i64,
    name: &str,
    house_number: Option<&str>,
    hierarchy: &AdminHierarchy,
    lat: Option<f64>,
    lon: Option<f64>,
    tags: &BTreeMap<String, String>,
) -> TantivyDocument {
    let mut d = TantivyDocument::default();

    d.add_i64(SCHEMA.id, id);
    d.add_text(SCHEMA.osm_type, osm_type);
    d.add_text(SCHEMA.place_kind, place_kind);
    d.add_i64(SCHEMA.admin_level, admin_level);

    d.add_text(SCHEMA.name, name);
    let name_ascii = vn_text::normalize(name);
    d.add_text(SCHEMA.name_ascii, &name_ascii);
    d.add_text(SCHEMA.name_ascii_ngram, &name_ascii);
    d.add_text(SCHEMA.name_compact, vn_text::compact(name));

    if let Some(hn) = house_number {
        d.add_text(SCHEMA.house_number, vn_text::normalize(hn));
    }

    if let Some(w) = &hierarchy.ward {
        d.add_text(SCHEMA.ward, w);
    } else if let Some(s) = tags
        .get("addr:suburb")
        .or_else(|| tags.get("addr:neighbourhood"))
    {
        d.add_text(SCHEMA.ward, vn_text::normalize(s));
    }
    if let Some(d2) = &hierarchy.district {
        d.add_text(SCHEMA.district, d2);
    } else if let Some(s) = tags.get("addr:district") {
        d.add_text(SCHEMA.district, vn_text::normalize(s));
    }
    if let Some(c) = &hierarchy.city {
        d.add_text(SCHEMA.city, c);
    } else if let Some(s) = tags.get("addr:city") {
        d.add_text(SCHEMA.city, vn_text::normalize(s));
    }
    if let Some(p) = &hierarchy.province {
        d.add_text(SCHEMA.province, p);
    } else if let Some(s) = tags.get("addr:province").or_else(|| tags.get("addr:state")) {
        d.add_text(SCHEMA.province, vn_text::normalize(s));
    }

    if let Some(lat) = lat {
        d.add_f64(SCHEMA.lat, lat);
    }
    if let Some(lon) = lon {
        d.add_f64(SCHEMA.lon, lon);
    }

    let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "{}".into());
    d.add_text(SCHEMA.tags_json, tags_json);

    d
}

/// Index a named node record (already has lat/lon from PBF).
fn index_node(
    writer: &tantivy::IndexWriter,
    rec: &NodeRecord,
    spatial: &SpatialIndex,
) -> Result<bool> {
    let name = match derive_name(&rec.tags) {
        Some(n) => n,
        None => return Ok(false),
    };
    let (place_kind, admin_level) = match classify(&rec.tags) {
        Some(c) => c,
        None => return Ok(false),
    };
    let house_number = rec.tags.get("addr:housenumber").map(|s| s.as_str());
    let hierarchy = spatial.lookup(rec.lat, rec.lon);

    let doc = build_doc(
        rec.id,
        "node",
        place_kind,
        admin_level,
        &name,
        house_number,
        &hierarchy,
        Some(rec.lat),
        Some(rec.lon),
        &rec.tags,
    );
    writer.add_document(doc)?;
    Ok(true)
}

/// Compute the centroid of a way from its node refs and the node-coord cache.
///
/// In `Full` mode, builds a `LineString` from all available node coords
/// and returns its centroid (length-weighted midpoint). In `FirstNode`
/// mode, only the first node's coords are available, so we return those.
///
/// Returns `None` if no coords are available at all.
fn compute_way_centroid(
    node_refs: &[i64],
    node_coords: &std::collections::HashMap<i64, (f32, f32)>,
) -> Option<(f64, f64)> {
    let coords: Vec<Coord> = node_refs
        .iter()
        .filter_map(|nid| node_coords.get(nid))
        .map(|&(lat, lon)| Coord {
            x: lon as f64,
            y: lat as f64,
        })
        .collect();
    if coords.is_empty() {
        return None;
    }
    if coords.len() == 1 {
        return Some((coords[0].y, coords[0].x));
    }
    // Use geo::Centroid on the LineString for a length-weighted midpoint.
    let line: LineString = coords.into();
    let c = line.centroid()?;
    Some((c.y(), c.x()))
}

/// Index a named way record.
fn index_way(
    writer: &tantivy::IndexWriter,
    rec: &WayRecord,
    node_coords: &std::collections::HashMap<i64, (f32, f32)>,
    spatial: &SpatialIndex,
) -> Result<bool> {
    let name = match derive_name(&rec.tags) {
        Some(n) => n,
        None => return Ok(false),
    };
    let (place_kind, admin_level) = match classify(&rec.tags) {
        Some(c) => c,
        None => return Ok(false),
    };
    let house_number = rec.tags.get("addr:housenumber").map(|s| s.as_str());

    // Compute centroid from all cached node coords.
    let (lat, lon) = compute_way_centroid(&rec.node_refs, node_coords).unwrap_or((0.0, 0.0));
    let has_coords = lat != 0.0 || lon != 0.0;
    let hierarchy = if has_coords {
        spatial.lookup(lat, lon)
    } else {
        AdminHierarchy::default()
    };

    let doc = build_doc(
        rec.id,
        "way",
        place_kind,
        admin_level,
        &name,
        house_number,
        &hierarchy,
        if has_coords { Some(lat) } else { None },
        if has_coords { Some(lon) } else { None },
        &rec.tags,
    );
    writer.add_document(doc)?;
    Ok(true)
}

/// Index an admin relation itself.
fn index_admin_relation(
    writer: &tantivy::IndexWriter,
    rel: &AdminRelationInfo,
    spatial: &SpatialIndex,
) -> Result<bool> {
    let centroid = find_admin_centroid(rel, spatial);
    let hierarchy = match centroid {
        Some((lat, lon)) => spatial.lookup_excluding_level(lat, lon, rel.admin_level),
        None => AdminHierarchy::default(),
    };

    let mut h = hierarchy;
    let name_ascii = vn_text::normalize(&rel.name);
    match rel.admin_level {
        4 => h.province = Some(name_ascii.clone()),
        6 | 7 => h.district = Some(name_ascii.clone()),
        8 => h.ward = Some(name_ascii.clone()),
        _ => {}
    }

    let doc = build_doc(
        rel.osm_id,
        "relation",
        rel.place_kind,
        rel.admin_level,
        &rel.name,
        None,
        &h,
        centroid.map(|(lat, _)| lat),
        centroid.map(|(_, lon)| lon),
        &BTreeMap::new(),
    );
    writer.add_document(doc)?;
    Ok(true)
}

fn find_admin_centroid(rel: &AdminRelationInfo, spatial: &SpatialIndex) -> Option<(f64, f64)> {
    let rtree = match rel.admin_level {
        4 => &spatial.provinces,
        6 | 7 => &spatial.districts,
        8 => &spatial.wards,
        _ => return None,
    };
    rtree
        .iter()
        .find(|a| a.osm_id == rel.osm_id)
        .and_then(|a| spatial::multipolygon_centroid(&a.geometry))
}

// -----------------------------------------------------------------------
// Main pipeline
// -----------------------------------------------------------------------

/// Summary of a completed [`run_index`] pass — surfaced by the CLI.
#[derive(Debug, Clone, Default)]
pub struct IndexStats {
    /// Total documents written to the Tantivy index.
    pub indexed: u64,
    /// Named nodes indexed.
    pub nodes: u64,
    /// Named ways indexed.
    pub ways: u64,
    /// Admin relations indexed.
    pub admins: u64,
}

/// Main entry point used by the CLI `import-osm` subcommand.
pub fn run_index(osm_path: &Path, index_dir: &Path, opts: &IndexOptions) -> Result<IndexStats> {
    let index = open_or_create_index(index_dir)?;
    let mut writer = if opts.max_threads <= 1 {
        // Single-threaded mode for CPU-constrained environments (cron).
        index.writer_with_num_threads(1, opts.heap_bytes)?
    } else {
        index.writer_with_num_threads(opts.max_threads, opts.heap_bytes)?
    };

    let temp_dir = index_dir.join("_tmp");
    std::fs::create_dir_all(&temp_dir)?;

    let start = Instant::now();

    // Pass 1: discover admin relations
    emit(opts, "pass 1/3: discovering administrative boundaries");
    info!("pass 1: discovering admin relations...");
    let pass1 = osm_reader::pass1_discover_admin(osm_path)?;

    // Pass 2: collect named nodes/ways + admin ways
    emit(
        opts,
        "pass 2/3: collecting named nodes and ways (first pass over PBF)",
    );
    info!(
        "pass 2: collecting nodes and ways (centroid={:?})...",
        opts.centroid_mode
    );
    let pass2 = osm_reader::pass2_collect_data(osm_path, &pass1, &temp_dir, opts.centroid_mode)?;

    // Pass 3: cache needed node coords
    emit(
        opts,
        "pass 3/3: caching node coordinates (second pass over PBF)",
    );
    info!("pass 3: caching node coordinates...");
    let node_coords = osm_reader::pass3_collect_node_coords(osm_path, &pass2.needed_node_ids)?;

    // Build spatial index
    emit(opts, "building spatial index (admin polygons + R-trees)");
    info!("building spatial index (R-trees with stitched polygons)...");
    let spatial_index =
        spatial::build_spatial_index(&pass1.admin_relations, &pass2.admin_ways, &node_coords)?;
    info!(
        "spatial index ready: {} provinces, {} districts, {} wards",
        spatial_index.province_count(),
        spatial_index.district_count(),
        spatial_index.ward_count()
    );

    // Release pass 2 admin_ways — no longer needed after spatial index
    // is built. Frees ~50 MB. node_coords is still needed for way indexing.
    drop(pass2.admin_ways);

    let mut total: u64 = 0;
    let mut last_commit: u64 = 0;
    let mut nodes_indexed: u64 = 0;
    let mut ways_indexed: u64 = 0;
    let mut admins_indexed: u64 = 0;

    // Index nodes from temp file
    emit(opts, "indexing named nodes from temp file");
    info!("indexing named nodes from temp file...");
    let nodes_file = std::fs::File::open(&pass2.nodes_file_path)?;
    let nodes_reader = BufReader::new(nodes_file);
    for line in nodes_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let rec: NodeRecord = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("skip malformed node line: {e}");
                continue;
            }
        };
        if index_node(&writer, &rec, &spatial_index)? {
            total += 1;
            nodes_indexed += 1;
            if total - last_commit >= COMMIT_BATCH {
                writer.commit()?;
                last_commit = total;
                let msg = format!("indexed {total} documents");
                emit(opts, &msg);
                info!(
                    "indexed {} docs in {:.1}s",
                    total,
                    start.elapsed().as_secs_f64()
                );
            }
        }
    }

    // Index ways from temp file
    emit(opts, "indexing named ways from temp file");
    info!("indexing named ways from temp file...");
    let ways_file = std::fs::File::open(&pass2.ways_file_path)?;
    let ways_reader = BufReader::new(ways_file);
    for line in ways_reader.lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let rec: WayRecord = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("skip malformed way line: {e}");
                continue;
            }
        };
        if index_way(&writer, &rec, &node_coords, &spatial_index)? {
            total += 1;
            ways_indexed += 1;
            if total - last_commit >= COMMIT_BATCH {
                writer.commit()?;
                last_commit = total;
                let msg = format!("indexed {total} documents");
                emit(opts, &msg);
                info!(
                    "indexed {} docs in {:.1}s",
                    total,
                    start.elapsed().as_secs_f64()
                );
            }
        }
    }

    // Index admin relations
    emit(opts, "indexing admin relations");
    info!("indexing admin relations...");
    for rel in &pass1.admin_relations {
        if index_admin_relation(&writer, rel, &spatial_index)? {
            total += 1;
            admins_indexed += 1;
            if total - last_commit >= COMMIT_BATCH {
                writer.commit()?;
                last_commit = total;
                let msg = format!("indexed {total} documents");
                emit(opts, &msg);
                info!(
                    "indexed {} docs in {:.1}s",
                    total,
                    start.elapsed().as_secs_f64()
                );
            }
        }
    }

    writer.commit()?;
    writer.wait_merging_threads()?;
    emit(opts, "merging index segments");

    // Cleanup temp files
    let _ = std::fs::remove_dir_all(&temp_dir);

    info!(
        "done: indexed {} docs in {:.1}s ({}/{} nodes, {}/{} ways, {}/{} admin relations)",
        total,
        start.elapsed().as_secs_f64(),
        nodes_indexed,
        pass2.nodes_count,
        ways_indexed,
        pass2.ways_count,
        admins_indexed,
        pass1.admin_relations.len()
    );

    Ok(IndexStats {
        indexed: total,
        nodes: nodes_indexed,
        ways: ways_indexed,
        admins: admins_indexed,
    })
}
