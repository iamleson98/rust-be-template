//! Multi-pass OSM PBF reader.
//!
//! ## Why multi-pass?
//!
//! To build the spatial hierarchy we need to know which ways belong to
//! admin relations — but relation definitions come *after* ways in the PBF
//! file. So we must scan once to discover admin relations, then scan again
//! to collect way data. A third pass collects coordinates for the specific
//! nodes we need (admin polygon nodes + first-node of each named way).
//!
//! ## RAM budget
//!
//! For a full Vietnam extract (~50M nodes, ~5M ways, ~10k admin relations):
//! - Pass 1 output: ~10k admin relations + ~200k admin-way IDs ≈ 20 MB
//! - Pass 2 output: admin-ways HashMap ≈ 50 MB; needed-node-ids HashSet ≈ 80 MB
//! - Pass 3 output: node-coords HashMap (f32×2) ≈ 160 MB
//! - Temp files (nodes.jsonl, ways.jsonl) on disk: ~2-4 GB
//! - Tantivy indexer heap: configurable via `--heap-mb`
//!
//! Peak RAM (excluding Tantivy heap): ~300 MB. With a 1 GB Tantivy heap,
//! total peak is ~1.3 GB — fits comfortably on a 2 GB machine.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use osmpbf::{Element, ElementReader, RelMemberType};
use serde::{Deserialize, Serialize};
use tracing::info;

// -----------------------------------------------------------------------
// Temp-file record types
// -----------------------------------------------------------------------

/// A node saved to temp file for later indexing.
#[derive(Debug, Serialize, Deserialize)]
pub struct NodeRecord {
    pub id: i64,
    pub lat: f64,
    pub lon: f64,
    pub tags: BTreeMap<String, String>,
}

/// A way saved to temp file for later indexing.
/// Stores ALL node refs so the indexer can compute a proper LineString
/// centroid (not just the first node).
#[derive(Debug, Serialize, Deserialize)]
pub struct WayRecord {
    pub id: i64,
    pub node_refs: Vec<i64>,
    pub tags: BTreeMap<String, String>,
}

/// An admin relation collected in memory during Pass 1.
#[derive(Debug)]
pub struct AdminRelationInfo {
    pub osm_id: i64,
    pub name: String,
    pub place_kind: &'static str,
    pub admin_level: i64,
    pub outer_way_ids: Vec<i64>,
}

// -----------------------------------------------------------------------
// Pass 1: discover admin relations
// -----------------------------------------------------------------------

/// Result of Pass 1.
pub struct Pass1Result {
    pub admin_relations: Vec<AdminRelationInfo>,
    pub admin_way_ids: HashSet<i64>,
}

/// Pass 1: iterate the PBF once to collect all administrative-boundary
/// relations and the IDs of ways that participate in their outer rings.
pub fn pass1_discover_admin<P: AsRef<Path>>(path: P) -> anyhow::Result<Pass1Result> {
    let mut admin_relations: Vec<AdminRelationInfo> = Vec::new();
    let mut admin_way_ids: HashSet<i64> = HashSet::new();

    let reader = ElementReader::from_path(&path)?;
    reader
        .for_each(|element| {
            if let Element::Relation(rel) = element {
                let tags: BTreeMap<String, String> = rel
                    .tags()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect();
                let is_admin = tags
                    .get("boundary")
                    .map(|v| v == "administrative")
                    .unwrap_or(false);
                if !is_admin {
                    return;
                }
                let name = match tags.get("name") {
                    Some(n) if !n.trim().is_empty() => n.clone(),
                    _ => return,
                };
                let admin_level: i64 = tags
                    .get("admin_level")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let place_kind = match admin_level {
                    2 => "country",
                    4 => "province",
                    6 | 7 => "district",
                    8 => "ward",
                    9 | 10 => "suburb",
                    _ => "admin",
                };
                // Collect outer way members.
                let outer_way_ids: Vec<i64> = rel
                    .members()
                    .filter(|m| {
                        m.member_type == RelMemberType::Way
                            && (m
                                .role()
                                .map(|r| r == "outer" || r.is_empty())
                                .unwrap_or(true))
                    })
                    .map(|m| m.member_id)
                    .collect();
                for wid in &outer_way_ids {
                    admin_way_ids.insert(*wid);
                }
                admin_relations.push(AdminRelationInfo {
                    osm_id: rel.id(),
                    name,
                    place_kind,
                    admin_level,
                    outer_way_ids,
                });
            }
        })
        .map_err(|e| anyhow::anyhow!("pass1: {e}"))?;

    info!(
        "pass1: {} admin relations, {} admin ways",
        admin_relations.len(),
        admin_way_ids.len()
    );
    Ok(Pass1Result {
        admin_relations,
        admin_way_ids,
    })
}

// -----------------------------------------------------------------------
// Pass 2: collect named nodes (temp file), named ways (temp file),
//         admin ways (memory), needed-node-ids set
// -----------------------------------------------------------------------

/// Controls how way centroids are computed, trading RAM for accuracy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CentroidMode {
    /// Cache ALL node coords for every named way and compute a proper
    /// `LineString` centroid. Uses ~2 GB RAM for full Vietnam but gives
    /// accurate hierarchy for long streets.
    Full,
    /// Cache only the FIRST node of each named way. Uses ~300 MB RAM
    /// but the hierarchy for long streets may be wrong (e.g. a street
    /// crossing district boundaries gets assigned to the district of its
    /// first node).
    FirstNode,
}

impl Default for CentroidMode {
    fn default() -> Self {
        CentroidMode::Full
    }
}

/// Result of Pass 2.
pub struct Pass2Result {
    pub admin_ways: HashMap<i64, Vec<i64>>, // way_id → node_refs
    pub needed_node_ids: HashSet<i64>,
    pub nodes_file_path: PathBuf,
    pub ways_file_path: PathBuf,
    pub nodes_count: u64,
    pub ways_count: u64,
}

/// Pass 2: collect data for indexing.
///
/// - Named/POI nodes → `nodes.jsonl` temp file (with coords, since nodes
///   carry their own lat/lon in the PBF).
/// - Named ways → `ways.jsonl` temp file (with ALL node refs; coords are
///   resolved in Pass 3).
/// - Admin ways (members of admin relations) → in-memory HashMap (needed
///   for polygon construction).
/// - `needed_node_ids` set: union of (admin-way node refs) + (named-way
///   node refs, or just first node in `FirstNode` mode). Drives Pass 3.
pub fn pass2_collect_data<P: AsRef<Path>>(
    path: P,
    pass1: &Pass1Result,
    temp_dir: &Path,
    centroid_mode: CentroidMode,
) -> anyhow::Result<Pass2Result> {
    let nodes_file_path = temp_dir.join("nodes.jsonl");
    let ways_file_path = temp_dir.join("ways.jsonl");
    let nodes_file = std::fs::File::create(&nodes_file_path)?;
    let ways_file = std::fs::File::create(&ways_file_path)?;
    let mut nodes_writer = BufWriter::new(nodes_file);
    let mut ways_writer = BufWriter::new(ways_file);

    let mut admin_ways: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut needed_node_ids: HashSet<i64> = HashSet::new();
    let mut nodes_count = 0u64;
    let mut ways_count = 0u64;

    let reader = ElementReader::from_path(&path)?;
    reader
        .for_each(|element| {
            match element {
                Element::Node(node) => {
                    let tags: BTreeMap<String, String> = node
                        .tags()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();
                    if should_index_element(&tags) {
                        let rec = NodeRecord {
                            id: node.id(),
                            lat: node.lat(),
                            lon: node.lon(),
                            tags,
                        };
                        if serde_json::to_writer(&mut nodes_writer, &rec).is_ok() {
                            let _ = writeln!(nodes_writer);
                            nodes_count += 1;
                        }
                    }
                }
                Element::DenseNode(node) => {
                    let tags: BTreeMap<String, String> = node
                        .tags()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();
                    if should_index_element(&tags) {
                        let rec = NodeRecord {
                            id: node.id(),
                            lat: node.lat(),
                            lon: node.lon(),
                            tags,
                        };
                        if serde_json::to_writer(&mut nodes_writer, &rec).is_ok() {
                            let _ = writeln!(nodes_writer);
                            nodes_count += 1;
                        }
                    }
                }
                Element::Way(way) => {
                    let way_id = way.id();
                    let tags: BTreeMap<String, String> = way
                        .tags()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();
                    let node_refs: Vec<i64> = way.refs().collect();

                    // If this way is part of an admin relation, cache its
                    // node refs and mark all nodes as "needed".
                    if pass1.admin_way_ids.contains(&way_id) {
                        for nid in &node_refs {
                            needed_node_ids.insert(*nid);
                        }
                        admin_ways.insert(way_id, node_refs.clone());
                    }

                    // If this way should be indexed, save to temp file
                    // and mark needed nodes for coord lookup.
                    if should_index_element(&tags) && !node_refs.is_empty() {
                        match centroid_mode {
                            CentroidMode::Full => {
                                // Cache ALL node coords for accurate centroid.
                                for nid in &node_refs {
                                    needed_node_ids.insert(*nid);
                                }
                            }
                            CentroidMode::FirstNode => {
                                // Cache only the first node's coords.
                                needed_node_ids.insert(node_refs[0]);
                            }
                        }
                        let rec = WayRecord {
                            id: way_id,
                            node_refs: node_refs.clone(),
                            tags,
                        };
                        if serde_json::to_writer(&mut ways_writer, &rec).is_ok() {
                            let _ = writeln!(ways_writer);
                            ways_count += 1;
                        }
                    }
                }
                _ => {}
            }
        })
        .map_err(|e| anyhow::anyhow!("pass2: {e}"))?;

    nodes_writer.flush()?;
    ways_writer.flush()?;

    info!(
        "pass2: {} admin ways, {} needed nodes, {} named nodes, {} named ways (centroid={:?})",
        admin_ways.len(),
        needed_node_ids.len(),
        nodes_count,
        ways_count,
        centroid_mode,
    );
    Ok(Pass2Result {
        admin_ways,
        needed_node_ids,
        nodes_file_path,
        ways_file_path,
        nodes_count,
        ways_count,
    })
}

// -----------------------------------------------------------------------
// Pass 3: collect coords for needed nodes
// -----------------------------------------------------------------------

/// Pass 3: iterate the PBF one more time, caching (lat, lon) for every
/// node whose ID is in `needed_node_ids`. Uses `f32` coords to halve
/// memory vs `f64` (precision ~1m at Vietnam's latitude — plenty for
/// polygon containment checks).
pub fn pass3_collect_node_coords<P: AsRef<Path>>(
    path: P,
    needed_node_ids: &HashSet<i64>,
) -> anyhow::Result<HashMap<i64, (f32, f32)>> {
    let mut node_coords: HashMap<i64, (f32, f32)> = HashMap::with_capacity(needed_node_ids.len());
    let reader = ElementReader::from_path(&path)?;
    reader
        .for_each(|element| match element {
            Element::Node(node) => {
                if needed_node_ids.contains(&node.id()) {
                    node_coords.insert(node.id(), (node.lat() as f32, node.lon() as f32));
                }
            }
            Element::DenseNode(node) => {
                if needed_node_ids.contains(&node.id()) {
                    node_coords.insert(node.id(), (node.lat() as f32, node.lon() as f32));
                }
            }
            _ => {}
        })
        .map_err(|e| anyhow::anyhow!("pass3: {e}"))?;

    info!("pass3: {} node coords cached", node_coords.len());
    Ok(node_coords)
}

// -----------------------------------------------------------------------
// Classification: decide which elements to index
// -----------------------------------------------------------------------

/// Decide if an element (node or way) should be indexed based on its tags.
///
/// We index as much meaningful data as possible:
/// - Anything with a `name` tag (the common case).
/// - Anything with alternative-name tags (`alt_name`, `official_name`,
///   `loc_name`, `old_name`, `short_name`).
/// - POIs (amenity/shop/tourism/office/leisure/historic/...) even without
///   a name — we derive a display name from the tag value.
/// - Buildings with `addr:housenumber` (so "123 Le Loi" can match).
/// - Highways (streets) even without a name (we derive from refs/addr).
pub fn should_index_element(tags: &BTreeMap<String, String>) -> bool {
    // Any explicit name tag
    for k in [
        "name",
        "alt_name",
        "official_name",
        "loc_name",
        "old_name",
        "short_name",
    ] {
        if let Some(v) = tags.get(k) {
            if !v.trim().is_empty() {
                return true;
            }
        }
    }

    // POI tags (expanded list — index even without a name)
    for k in [
        "amenity",
        "shop",
        "tourism",
        "office",
        "leisure",
        "historic",
        "man_made",
        "natural",
        "craft",
        "healthcare",
        "public_transport",
        "railway",
        "aeroway",
        "sport",
        "club",
        "education",
        "emergency",
        "telecom",
        "utility",
        "military",
        "car",
        "car_rental",
        "car_wash",
        "parking",
        "fuel",
        "atm",
        "bench",
        "post_box",
        "waste_basket",
        "drinking_water",
        "water_point",
        "barrier",
    ] {
        if tags.contains_key(k) {
            return true;
        }
    }

    // Highways (streets) — only if named OR has a reference
    if tags.contains_key("highway") {
        // Index named highways, or highways with a reference number
        // (e.g. QL1, AH1) so users can search for road numbers.
        if tags.contains_key("ref") {
            return true;
        }
        // Also index residential/service ways if they have addr:housenumber
        // (unusual but possible).
        if tags.contains_key("addr:housenumber") {
            return true;
        }
    }

    // Buildings with house numbers
    if tags.contains_key("addr:housenumber") {
        return true;
    }

    // Waterways with names (already caught by name check, but keep for clarity)
    // Landuse with names (already caught by name check)

    false
}

/// Derive a display name for an element from its tags, using a fallback
/// chain when no `name` tag is present.
pub fn derive_name(tags: &BTreeMap<String, String>) -> Option<String> {
    // Try explicit name tags in priority order
    for k in [
        "name",
        "official_name",
        "alt_name",
        "short_name",
        "loc_name",
        "old_name",
    ] {
        if let Some(n) = tags.get(k) {
            if !n.trim().is_empty() {
                return Some(n.clone());
            }
        }
    }

    // For POIs, construct a name from type + operator/brand/branch
    if let Some(amenity) = tags.get("amenity") {
        if let Some(brand) = tags.get("brand") {
            return Some(brand.clone());
        }
        if let Some(op) = tags.get("operator") {
            return Some(format!("{op} {amenity}"));
        }
        if let Some(branch) = tags.get("branch") {
            return Some(format!("{amenity} {branch}"));
        }
        return Some(amenity.clone());
    }
    if let Some(shop) = tags.get("shop") {
        if let Some(brand) = tags.get("brand") {
            return Some(brand.clone());
        }
        if let Some(name) = tags.get("operator") {
            return Some(name.clone());
        }
        return Some(shop.clone());
    }
    if let Some(tourism) = tags.get("tourism") {
        return Some(tourism.clone());
    }
    if let Some(office) = tags.get("office") {
        return Some(office.clone());
    }
    if let Some(leisure) = tags.get("leisure") {
        return Some(leisure.clone());
    }
    if let Some(historic) = tags.get("historic") {
        return Some(historic.clone());
    }

    // For highways with a reference number
    if tags.contains_key("highway") {
        if let Some(r) = tags.get("ref") {
            return Some(format!("Đường {r}"));
        }
    }

    // For buildings with house number
    if let Some(hn) = tags.get("addr:housenumber") {
        if let Some(street) = tags.get("addr:street") {
            return Some(format!("{hn} {street}"));
        }
        return Some(hn.clone());
    }

    // Fallback: first non-empty tag value
    for v in tags.values() {
        if !v.is_empty() {
            return Some(v.clone());
        }
    }
    None
}

/// Classify a place based on its tags. Returns (place_kind, admin_level).
pub fn classify(tags: &BTreeMap<String, String>) -> Option<(&'static str, i64)> {
    // Administrative boundary
    if tags
        .get("boundary")
        .map(|v| v == "administrative")
        .unwrap_or(false)
    {
        let al: i64 = tags
            .get("admin_level")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let kind = match al {
            2 => "country",
            4 => "province",
            6 | 7 => "district",
            8 => "ward",
            9 | 10 => "suburb",
            _ => "admin",
        };
        return Some((kind, al));
    }

    // Named place (city/town/village/...)
    if let Some(p) = tags.get("place") {
        let kind = match p.as_str() {
            "city" | "town" => "city",
            "municipality" => "city",
            "borough" | "suburb" | "quarter" | "neighbourhood" => "suburb",
            "village" => "village",
            "hamlet" => "hamlet",
            "island" | "islet" => "island",
            "county" | "state" | "region" | "province" => "province",
            _ => "place",
        };
        return Some((kind, 0));
    }

    // Highway (street)
    if tags.contains_key("highway") {
        return Some(("street", 0));
    }

    // POIs (expanded list)
    for k in [
        "amenity",
        "shop",
        "tourism",
        "office",
        "leisure",
        "historic",
        "man_made",
        "natural",
        "craft",
        "healthcare",
        "public_transport",
        "railway",
        "aeroway",
        "sport",
        "club",
        "education",
        "emergency",
        "telecom",
        "utility",
        "military",
        "car",
        "car_rental",
        "car_wash",
        "parking",
        "fuel",
        "atm",
        "bench",
        "post_box",
        "waste_basket",
        "drinking_water",
        "water_point",
        "barrier",
    ] {
        if tags.contains_key(k) {
            return Some(("poi", 0));
        }
    }

    // Buildings
    if tags.contains_key("building") {
        return Some(("building", 0));
    }

    // Waterways
    if tags.contains_key("waterway") {
        return Some(("waterway", 0));
    }

    // Landuse
    if tags.contains_key("landuse") {
        return Some(("landuse", 0));
    }

    // Fallback: anything with a name
    if should_index_element(tags) {
        return Some(("place", 0));
    }
    None
}
