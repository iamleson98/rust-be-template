//! place-extract — OSM PBF → travel-relevant places, one JSON object per line.
//!
//! Feeds the static place-search index (cloudflare/scripts/build-place-shards.ts):
//! a weekly CI job runs this on the Geofabrik Vietnam extract, so the
//! Workers deployment needs no database, container or native binary to
//! search places.
//!
//! The heavy lifting (multi-pass PBF read, admin polygon stitching, R-tree
//! hierarchy lookup) is the backend's own code, included by path so the two
//! cannot drift. Only the output sink and the "what is worth shipping"
//! filter (`travel.rs`) are new.

mod osm;
mod travel;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use clap::{Parser, ValueEnum};
use geo::{Centroid, Contains, Coord, LineString, Point};
use osm::osm_reader::{self, AdminRelationInfo, CentroidMode, NodeRecord, WayRecord};
use osm::spatial::{self, AdminArea, SpatialIndex};
use serde::Serialize;
use tracing::info;

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Centroids {
    /// Cache every node of every named way: accurate, ~2 GB RAM for Vietnam.
    Full,
    /// Cache only each way's first node: ~300 MB RAM, good enough for stations.
    First,
}

#[derive(Debug, Parser)]
#[command(version, about)]
struct Args {
    /// Path to the `.osm.pbf` extract (e.g. vietnam-latest.osm.pbf).
    pbf: PathBuf,
    /// Output NDJSON file.
    #[arg(long, short)]
    out: PathBuf,
    /// Scratch directory for the intermediate node/way files (deleted afterwards).
    #[arg(long)]
    tmp_dir: Option<PathBuf>,
    #[arg(long, value_enum, default_value_t = Centroids::First)]
    centroids: Centroids,
}

/// One shipped place. Names keep their diacritics: tone folding is done by the
/// shard builder so index time and query time share one normaliser.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Place {
    osm_id: i64,
    osm_type: &'static str,
    kind: &'static str,
    name: String,
    province: Option<String>,
    district: Option<String>,
    ward: Option<String>,
    lat: f64,
    lon: f64,
    population: i64,
}

#[derive(Debug, Default)]
struct Hierarchy {
    province: Option<String>,
    district: Option<String>,
    ward: Option<String>,
}

fn containing<'a>(
    tree: &'a rstar::RTree<AdminArea>,
    point: &Point,
    coord: &[f64; 2],
) -> Option<&'a AdminArea> {
    tree.locate_all_at_point(coord)
        .find(|a| a.geometry.contains(point))
}

/// Display-name hierarchy of a point (the backend's `SpatialIndex::lookup`
/// returns tone-stripped names, which are useless for showing to users).
fn hierarchy(spatial: &SpatialIndex, lat: f64, lon: f64, exclude_level: i64) -> Hierarchy {
    let point = Point::new(lon, lat);
    let coord = [lon, lat];
    let name = |a: Option<&AdminArea>| a.map(|a| a.name.clone());
    Hierarchy {
        province: if exclude_level == 4 {
            None
        } else {
            name(containing(&spatial.provinces, &point, &coord))
        },
        district: if exclude_level == 6 || exclude_level == 7 {
            None
        } else {
            name(containing(&spatial.districts, &point, &coord))
        },
        ward: if exclude_level == 8 {
            None
        } else {
            name(containing(&spatial.wards, &point, &coord))
        },
    }
}

fn way_centroid(node_refs: &[i64], node_coords: &HashMap<i64, (f32, f32)>) -> Option<(f64, f64)> {
    let coords: Vec<Coord> = node_refs
        .iter()
        .filter_map(|id| node_coords.get(id))
        .map(|&(lat, lon)| Coord {
            x: lon as f64,
            y: lat as f64,
        })
        .collect();
    match coords.len() {
        0 => None,
        1 => Some((coords[0].y, coords[0].x)),
        _ => {
            let c = LineString::from(coords).centroid()?;
            Some((c.y(), c.x()))
        }
    }
}

fn admin_centroid(rel: &AdminRelationInfo, spatial: &SpatialIndex) -> Option<(f64, f64)> {
    let tree = match rel.admin_level {
        4 => &spatial.provinces,
        6 | 7 => &spatial.districts,
        8 => &spatial.wards,
        _ => return None,
    };
    tree.iter()
        .find(|a| a.osm_id == rel.osm_id)
        .and_then(|a| spatial::multipolygon_centroid(&a.geometry))
}

fn emit<W: Write>(out: &mut W, place: &Place) -> Result<()> {
    serde_json::to_writer(&mut *out, place)?;
    out.write_all(b"\n")?;
    Ok(())
}

/// Stream `*.jsonl` scratch records, skipping blank/malformed lines.
fn records<T: serde::de::DeserializeOwned>(path: &Path) -> Result<impl Iterator<Item = T>> {
    let file = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    Ok(BufReader::new(file)
        .lines()
        .map_while(|l| l.ok())
        .filter(|l| !l.is_empty())
        .filter_map(|l| match serde_json::from_str::<T>(&l) {
            Ok(r) => Some(r),
            Err(e) => {
                tracing::warn!("skip malformed scratch line: {e}");
                None
            }
        }))
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let args = Args::parse();
    anyhow::ensure!(args.pbf.exists(), "PBF not found: {}", args.pbf.display());

    let tmp = args
        .tmp_dir
        .clone()
        .unwrap_or_else(|| args.out.with_extension("tmp"));
    std::fs::create_dir_all(&tmp)?;
    let mode = match args.centroids {
        Centroids::Full => CentroidMode::Full,
        Centroids::First => CentroidMode::FirstNode,
    };
    let started = Instant::now();

    info!("pass 1/3: administrative boundaries");
    let pass1 = osm_reader::pass1_discover_admin(&args.pbf)?;
    info!("pass 2/3: named nodes and ways");
    let pass2 = osm_reader::pass2_collect_data(&args.pbf, &pass1, &tmp, mode)?;
    info!(
        "pass 3/3: node coordinates ({} needed)",
        pass2.needed_node_ids.len()
    );
    let node_coords = osm_reader::pass3_collect_node_coords(&args.pbf, &pass2.needed_node_ids)?;
    info!("building admin spatial index");
    let spatial =
        spatial::build_spatial_index(&pass1.admin_relations, &pass2.admin_ways, &node_coords)?;
    drop(pass2.admin_ways);

    let mut out = BufWriter::new(std::fs::File::create(&args.out)?);
    let (mut nodes, mut ways, mut admins) = (0u64, 0u64, 0u64);

    for rec in records::<NodeRecord>(&pass2.nodes_file_path)? {
        let Some(kind) = travel::travel_kind(&rec.tags) else {
            continue;
        };
        let h = hierarchy(&spatial, rec.lat, rec.lon, 0);
        emit(
            &mut out,
            &Place {
                osm_id: rec.id,
                osm_type: "node",
                kind,
                name: rec.tags["name"].trim().to_string(),
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat: rec.lat,
                lon: rec.lon,
                population: travel::parse_population(&rec.tags),
            },
        )?;
        nodes += 1;
    }

    for rec in records::<WayRecord>(&pass2.ways_file_path)? {
        let Some(kind) = travel::travel_kind(&rec.tags) else {
            continue;
        };
        let Some((lat, lon)) = way_centroid(&rec.node_refs, &node_coords) else {
            continue;
        };
        let h = hierarchy(&spatial, lat, lon, 0);
        emit(
            &mut out,
            &Place {
                osm_id: rec.id,
                osm_type: "way",
                kind,
                name: rec.tags["name"].trim().to_string(),
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat,
                lon,
                population: travel::parse_population(&rec.tags),
            },
        )?;
        ways += 1;
    }

    for rel in &pass1.admin_relations {
        // Countries and unclassified admin levels are not destinations.
        if matches!(rel.place_kind, "country" | "admin") {
            continue;
        }
        let Some((lat, lon)) = admin_centroid(rel, &spatial) else {
            continue;
        };
        let mut h = hierarchy(&spatial, lat, lon, rel.admin_level);
        match rel.admin_level {
            4 => h.province = Some(rel.name.clone()),
            6 | 7 => h.district = Some(rel.name.clone()),
            8 => h.ward = Some(rel.name.clone()),
            _ => {}
        }
        emit(
            &mut out,
            &Place {
                osm_id: rel.osm_id,
                osm_type: "relation",
                kind: rel.place_kind,
                name: rel.name.clone(),
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat,
                lon,
                population: 0,
            },
        )?;
        admins += 1;
    }

    out.flush()?;
    let _ = std::fs::remove_dir_all(&tmp);
    info!(
        "done in {:.1}s: {} places ({nodes} nodes, {ways} ways, {admins} admin areas) -> {}",
        started.elapsed().as_secs_f64(),
        nodes + ways + admins,
        args.out.display()
    );
    Ok(())
}
