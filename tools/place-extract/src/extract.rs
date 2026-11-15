//! The extraction run: three PBF passes, then one NDJSON line per place.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{Context, Result};
use geo::{Centroid, Contains, Coord, LineString, Point};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::osm::osm_reader::{self, AdminRelationInfo, CentroidMode, NodeRecord, WayRecord};
use crate::osm::spatial::{self, AdminArea, SpatialIndex};
use crate::travel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum Centroids {
    /// Cache every node of every named way: accurate, ~2 GB RAM for Vietnam.
    Full,
    /// Cache only each way's first node: ~300 MB RAM, good enough for stations.
    First,
}

#[derive(Debug, Clone)]
pub struct ExtractOptions {
    /// Path to the `.osm.pbf` extract (e.g. vietnam-latest.osm.pbf).
    pub pbf: PathBuf,
    /// Output NDJSON file.
    pub out: PathBuf,
    /// Scratch directory for the intermediate node/way files (deleted afterwards).
    pub tmp_dir: PathBuf,
    pub centroids: Centroids,
    /// How much of OSM to ship (each profile includes the one before it).
    pub profile: travel::Profile,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ExtractStats {
    pub nodes: u64,
    pub ways: u64,
    /// Named multipolygon relations (campuses, lakes, airports…).
    pub areas: u64,
    pub admins: u64,
}

impl ExtractStats {
    pub fn total(&self) -> u64 {
        self.nodes + self.ways + self.areas + self.admins
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OsmType {
    Node,
    Way,
    Relation,
}

impl OsmType {
    /// One-letter id prefix: node 123 → "n123".
    pub fn letter(self) -> char {
        match self {
            OsmType::Node => 'n',
            OsmType::Way => 'w',
            OsmType::Relation => 'r',
        }
    }
}

/// One extracted place (one NDJSON line). Names keep their diacritics: tone
/// folding is done by whoever indexes them, so index time and query time
/// share one normaliser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawPlace {
    pub osm_id: i64,
    pub osm_type: OsmType,
    pub kind: String,
    pub name: String,
    /// Other names for the same place (searchable, never displayed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alt_names: Vec<String>,
    pub province: Option<String>,
    pub district: Option<String>,
    pub ward: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub population: i64,
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

/// Display-name hierarchy of a point (`SpatialIndex::lookup` returns
/// tone-stripped names, which are useless for showing to users).
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

fn emit<W: Write>(out: &mut W, place: &RawPlace) -> Result<()> {
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

/// Reads the PBF and writes one [`RawPlace`] per line to `opts.out`.
pub fn extract(opts: &ExtractOptions) -> Result<ExtractStats> {
    anyhow::ensure!(opts.pbf.exists(), "PBF not found: {}", opts.pbf.display());
    std::fs::create_dir_all(&opts.tmp_dir)?;
    let mode = match opts.centroids {
        Centroids::Full => CentroidMode::Full,
        Centroids::First => CentroidMode::FirstNode,
    };
    let started = Instant::now();

    info!("pass 1/3: administrative boundaries");
    let pass1 = osm_reader::pass1_discover_admin(&opts.pbf)?;
    info!("pass 2/3: named nodes and ways");
    let pass2 = osm_reader::pass2_collect_data(&opts.pbf, &pass1, &opts.tmp_dir, mode)?;
    info!(
        "pass 3/3: node coordinates ({} needed)",
        pass2.needed_node_ids.len()
    );
    let node_coords = osm_reader::pass3_collect_node_coords(&opts.pbf, &pass2.needed_node_ids)?;
    info!("building admin spatial index");
    let spatial =
        spatial::build_spatial_index(&pass1.admin_relations, &pass2.admin_ways, &node_coords)?;
    drop(pass2.admin_ways);
    let relation_way_first_node = pass2.relation_way_first_node;

    let mut out = BufWriter::new(
        std::fs::File::create(&opts.out)
            .with_context(|| format!("create {}", opts.out.display()))?,
    );
    let mut stats = ExtractStats::default();

    for rec in records::<NodeRecord>(&pass2.nodes_file_path)? {
        let Some(kind) = travel::travel_kind(&rec.tags, opts.profile) else {
            continue;
        };
        let Some(name) = travel::place_name(&rec.tags) else {
            continue;
        };
        let h = hierarchy(&spatial, rec.lat, rec.lon, 0);
        emit(
            &mut out,
            &RawPlace {
                osm_id: rec.id,
                osm_type: OsmType::Node,
                kind,
                alt_names: travel::alt_names(&rec.tags, &name),
                name,
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat: rec.lat,
                lon: rec.lon,
                population: travel::parse_population(&rec.tags),
            },
        )?;
        stats.nodes += 1;
    }

    for rec in records::<WayRecord>(&pass2.ways_file_path)? {
        let Some(kind) = travel::travel_kind(&rec.tags, opts.profile) else {
            continue;
        };
        let Some(name) = travel::place_name(&rec.tags) else {
            continue;
        };
        let Some((lat, lon)) = way_centroid(&rec.node_refs, &node_coords) else {
            continue;
        };
        let h = hierarchy(&spatial, lat, lon, 0);
        emit(
            &mut out,
            &RawPlace {
                osm_id: rec.id,
                osm_type: OsmType::Way,
                kind,
                alt_names: travel::alt_names(&rec.tags, &name),
                name,
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat,
                lon,
                population: travel::parse_population(&rec.tags),
            },
        )?;
        stats.ways += 1;
    }

    for rel in &pass1.named_relations {
        let Some(kind) = travel::travel_kind(&rel.tags, opts.profile) else {
            continue;
        };
        let Some(name) = travel::place_name(&rel.tags) else {
            continue;
        };
        let points: Vec<(f32, f32)> = rel
            .outer_way_ids
            .iter()
            .filter_map(|w| relation_way_first_node.get(w))
            .filter_map(|n| node_coords.get(n).copied())
            .collect();
        if points.is_empty() {
            continue;
        }
        let n = points.len() as f64;
        let lat = points.iter().map(|p| p.0 as f64).sum::<f64>() / n;
        let lon = points.iter().map(|p| p.1 as f64).sum::<f64>() / n;
        let h = hierarchy(&spatial, lat, lon, 0);
        emit(
            &mut out,
            &RawPlace {
                osm_id: rel.osm_id,
                osm_type: OsmType::Relation,
                kind,
                alt_names: travel::alt_names(&rel.tags, &name),
                name,
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat,
                lon,
                population: travel::parse_population(&rel.tags),
            },
        )?;
        stats.areas += 1;
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
            &RawPlace {
                osm_id: rel.osm_id,
                osm_type: OsmType::Relation,
                kind: rel.place_kind.to_string(),
                name: rel.name.clone(),
                alt_names: Vec::new(),
                province: h.province,
                district: h.district,
                ward: h.ward,
                lat,
                lon,
                population: 0,
            },
        )?;
        stats.admins += 1;
    }

    out.flush()?;
    let _ = std::fs::remove_dir_all(&opts.tmp_dir);
    info!(
        "done in {:.1}s: {} places ({} nodes, {} ways, {} named areas, {} admin areas) -> {}",
        started.elapsed().as_secs_f64(),
        stats.total(),
        stats.nodes,
        stats.ways,
        stats.areas,
        stats.admins,
        opts.out.display()
    );
    Ok(stats)
}
