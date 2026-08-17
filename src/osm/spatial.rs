//! Spatial hierarchy: build R-trees of administrative-boundary polygons
//! and query them to assign ward / district / city / province to every
//! place.
//!
//! ## Polygon construction (proper way stitching)
//!
//! OSM admin relations reference multiple *ways* (by id) as members with
//! role `"outer"`. Each way is a sequence of node IDs. To build a correct
//! polygon we must **stitch** these ways into closed rings by matching
//! endpoints, handling direction reversals.
//!
//! Algorithm:
//! 1. Collect all outer ways for the relation.
//! 2. Greedily stitch: start from any way, find another way whose first
//!    or last node matches the current ring's last node. Reverse the
//!    matched way if needed. Append (skipping the duplicate endpoint).
//! 3. When the ring closes (last node == first node), save it and start
//!    a new ring from any remaining unused way.
//! 4. If no matching way is found and the ring is open, force-close it
//!    by appending the start node.
//! 5. Build a [`geo::MultiPolygon`] from all rings (handles disjoint
//!    territories like provinces with islands).

use crate::osm::{osm_reader::AdminRelationInfo, vn_text};
use anyhow::Result;
use geo::{Centroid, Contains, Coord, LineString, MultiPolygon, Point, Polygon};
use rstar::{PointDistance, RTree, RTreeObject, AABB};
use std::collections::HashMap;
use tracing::info;

/// An administrative area with its polygon geometry, stored in an R-tree.
pub struct AdminArea {
    pub osm_id: i64,
    pub name: String,
    pub name_ascii: String,
    pub name_compact: String,
    pub place_kind: &'static str,
    pub admin_level: i64,
    /// MultiPolygon to correctly handle admins with disjoint territories
    /// (e.g. a province with islands).
    pub geometry: MultiPolygon,
}

impl RTreeObject for AdminArea {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        // Compute the bounding box across ALL polygons in the MultiPolygon.
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for poly in &self.geometry.0 {
            for c in poly.exterior().coords() {
                min_x = min_x.min(c.x);
                min_y = min_y.min(c.y);
                max_x = max_x.max(c.x);
                max_y = max_y.max(c.y);
            }
        }
        if min_x.is_infinite() {
            return AABB::from_corners([0.0, 0.0], [0.0, 0.0]);
        }
        AABB::from_corners([min_x, min_y], [max_x, max_y])
    }
}

impl PointDistance for AdminArea {
    fn distance_2(&self, point: &[f64; 2]) -> f64 {
        let p = Point::new(point[0], point[1]);
        // If any polygon contains the point, distance is 0.
        for poly in &self.geometry.0 {
            if poly.contains(&p) {
                return 0.0;
            }
        }
        // Otherwise, squared distance to the bounding box.
        let env = self.envelope();
        let lower = env.lower();
        let upper = env.upper();
        let dx = (point[0] - lower[0]).max(0.0).max(upper[0] - point[0]);
        let dy = (point[1] - lower[1]).max(0.0).max(upper[1] - point[1]);
        dx * dx + dy * dy
    }

    fn contains_point(&self, point: &[f64; 2]) -> bool {
        let p = Point::new(point[0], point[1]);
        // Point is contained if ANY polygon in the MultiPolygon contains it.
        self.geometry.0.iter().any(|poly| poly.contains(&p))
    }
}

/// The admin hierarchy assigned to a place based on its coordinates.
#[derive(Debug, Clone, Default)]
pub struct AdminHierarchy {
    pub ward: Option<String>,
    pub district: Option<String>,
    pub city: Option<String>,
    pub province: Option<String>,
}

/// Three R-trees: one per admin level.
pub struct SpatialIndex {
    pub provinces: RTree<AdminArea>,
    pub districts: RTree<AdminArea>,
    pub wards: RTree<AdminArea>,
}

impl SpatialIndex {
    /// Look up the admin hierarchy for a (lat, lon) point.
    pub fn lookup(&self, lat: f64, lon: f64) -> AdminHierarchy {
        let point = Point::new(lon, lat);
        let coord = [lon, lat];

        let province = self
            .provinces
            .locate_all_at_point(&coord)
            .find(|a| a.geometry.contains(&point));
        let district = self
            .districts
            .locate_all_at_point(&coord)
            .find(|a| a.geometry.contains(&point));
        let ward = self
            .wards
            .locate_all_at_point(&coord)
            .find(|a| a.geometry.contains(&point));

        let city = province
            .filter(|a| a.place_kind == "city")
            .or_else(|| district.filter(|a| a.place_kind == "city"))
            .map(|a| a.name_ascii.clone());

        AdminHierarchy {
            ward: ward.map(|a| a.name_ascii.clone()),
            district: district.map(|a| a.name_ascii.clone()),
            city,
            province: province.map(|a| a.name_ascii.clone()),
        }
    }

    /// Same as [`lookup`] but skips the specified admin level.
    pub fn lookup_excluding_level(&self, lat: f64, lon: f64, exclude_level: i64) -> AdminHierarchy {
        let point = Point::new(lon, lat);
        let coord = [lon, lat];

        let province = if exclude_level == 4 {
            None
        } else {
            self.provinces
                .locate_all_at_point(&coord)
                .find(|a| a.geometry.contains(&point))
        };
        let district = if exclude_level == 6 || exclude_level == 7 {
            None
        } else {
            self.districts
                .locate_all_at_point(&coord)
                .find(|a| a.geometry.contains(&point))
        };
        let ward = if exclude_level == 8 {
            None
        } else {
            self.wards
                .locate_all_at_point(&coord)
                .find(|a| a.geometry.contains(&point))
        };

        let city = province
            .filter(|a| a.place_kind == "city")
            .or_else(|| district.filter(|a| a.place_kind == "city"))
            .map(|a| a.name_ascii.clone());

        AdminHierarchy {
            ward: ward.map(|a| a.name_ascii.clone()),
            district: district.map(|a| a.name_ascii.clone()),
            city,
            province: province.map(|a| a.name_ascii.clone()),
        }
    }

    pub fn province_count(&self) -> usize {
        self.provinces.size()
    }
    pub fn district_count(&self) -> usize {
        self.districts.size()
    }
    pub fn ward_count(&self) -> usize {
        self.wards.size()
    }
}

// -----------------------------------------------------------------------
// Way stitching
// -----------------------------------------------------------------------

/// Stitch a set of ways (each a list of node IDs) into closed rings by
/// matching endpoints.
///
/// Algorithm:
/// 1. Start from any unused way. This becomes the seed of a new ring.
/// 2. Look at the ring's last node. Find an unused way whose first or
///    last node matches. If the match is on the way's last node, reverse
///    the way first.
/// 3. Append the matched way (skipping the duplicate endpoint).
/// 4. If the ring's last node equals its first node, the ring is closed.
/// 5. If no matching way is found and the ring is still open, force-close
///    it by appending the start node.
/// 6. Repeat from step 1 until all ways are consumed.
///
/// This correctly handles:
/// - Ways stored in arbitrary order.
/// - Ways stored in reversed direction.
/// - Disjoint territories (multiple rings from one relation).
/// - Broken geometry (force-closes open rings).
pub fn stitch_rings(ways: &[Vec<i64>]) -> Vec<Vec<i64>> {
    if ways.is_empty() {
        return Vec::new();
    }

    // Work with a list of optional ways (None = already consumed).
    let mut pool: Vec<Option<Vec<i64>>> = ways.iter().map(|w| Some(w.clone())).collect();
    let mut rings: Vec<Vec<i64>> = Vec::new();

    // The loop body has multiple `continue` paths that re-seed from the
    // pool — a `while let` form would obscure the seed-finding logic.
    #[allow(clippy::while_let_loop)]
    loop {
        // Find the first unused way to seed a new ring.
        let start_idx = match pool.iter().position(|w| w.is_some()) {
            Some(i) => i,
            None => break,
        };
        let mut ring = pool[start_idx].take().unwrap();
        if ring.is_empty() {
            continue;
        }
        let start_node = ring[0];
        let mut last_node = *ring.last().unwrap();

        // If the seed way is already a closed ring (first == last), save it.
        if ring.len() >= 4 && start_node == last_node {
            rings.push(ring);
            continue;
        }

        // Greedily extend the ring.
        loop {
            if last_node == start_node {
                rings.push(ring);
                break;
            }

            // Find an unused way that shares last_node as an endpoint.
            let found = pool.iter_mut().enumerate().find_map(|(i, opt)| {
                let w = opt.as_ref()?;
                if w.len() < 2 {
                    return None;
                }
                let w_first = *w.first().unwrap();
                let w_last = *w.last().unwrap();
                if w_first == last_node {
                    Some((i, false)) // forward: append as-is
                } else if w_last == last_node {
                    Some((i, true)) // reversed: need to flip
                } else {
                    None
                }
            });

            match found {
                Some((i, reverse)) => {
                    let mut w = pool[i].take().unwrap();
                    if reverse {
                        w.reverse();
                    }
                    // Skip the first node of w — it's the same as our last.
                    ring.extend(w.into_iter().skip(1));
                    last_node = *ring.last().unwrap();
                }
                None => {
                    // No matching way — force-close the ring.
                    if last_node != start_node {
                        ring.push(start_node);
                    }
                    rings.push(ring);
                    break;
                }
            }
        }
    }

    rings
}

/// Convert a list of node IDs into a `Vec<Coord>` using the node-coord cache.
/// Returns `None` if fewer than 3 distinct coordinates are available.
fn ring_to_coords(ring: &[i64], node_coords: &HashMap<i64, (f32, f32)>) -> Option<Vec<Coord>> {
    let coords: Vec<Coord> = ring
        .iter()
        .filter_map(|nid| node_coords.get(nid))
        .map(|&(lat, lon)| Coord {
            x: lon as f64,
            y: lat as f64,
        })
        .collect();
    // Need at least 4 points for a valid closed ring (3 distinct + closing).
    if coords.len() < 4 {
        return None;
    }
    // Ensure the ring is closed.
    if coords.first() != coords.last() {
        let first = coords[0];
        coords_push_close(coords, first)
    } else {
        Some(coords)
    }
}

// Helper: push closing coord and return. (Workaround for closure borrow issues.)
fn coords_push_close(mut coords: Vec<Coord>, first: Coord) -> Option<Vec<Coord>> {
    coords.push(first);
    Some(coords)
}

/// Build a `MultiPolygon` from a set of outer ways by stitching them
/// into rings and converting each ring to a `Polygon`.
///
/// Returns `None` if no valid rings could be built (e.g. all node coords
/// are missing).
pub fn build_multipolygon(
    outer_way_node_refs: &[Vec<i64>],
    node_coords: &HashMap<i64, (f32, f32)>,
) -> Option<MultiPolygon> {
    let rings = stitch_rings(outer_way_node_refs);
    let mut polygons: Vec<Polygon> = Vec::new();
    for ring in &rings {
        let coords = match ring_to_coords(ring, node_coords) {
            Some(c) => c,
            None => continue,
        };
        let line_string: LineString = coords.into();
        polygons.push(Polygon::new(line_string, vec![]));
    }
    if polygons.is_empty() {
        return None;
    }
    Some(MultiPolygon::new(polygons))
}

/// Build the spatial index from collected admin relations, admin ways,
/// and node coordinates.
pub fn build_spatial_index(
    admin_relations: &[AdminRelationInfo],
    admin_ways: &HashMap<i64, Vec<i64>>,
    node_coords: &HashMap<i64, (f32, f32)>,
) -> Result<SpatialIndex> {
    let mut provinces: Vec<AdminArea> = Vec::new();
    let mut districts: Vec<AdminArea> = Vec::new();
    let mut wards: Vec<AdminArea> = Vec::new();

    let mut skipped_no_polygon = 0u64;

    for rel in admin_relations {
        let outer_way_node_refs: Vec<Vec<i64>> = rel
            .outer_way_ids
            .iter()
            .filter_map(|wid| admin_ways.get(wid).cloned())
            .collect();
        if outer_way_node_refs.is_empty() {
            skipped_no_polygon += 1;
            continue;
        }
        let geometry = match build_multipolygon(&outer_way_node_refs, node_coords) {
            Some(g) => g,
            None => {
                skipped_no_polygon += 1;
                continue;
            }
        };
        let name_ascii = vn_text::normalize(&rel.name);
        let name_compact = vn_text::compact(&rel.name);
        let area = AdminArea {
            osm_id: rel.osm_id,
            name: rel.name.clone(),
            name_ascii,
            name_compact,
            place_kind: rel.place_kind,
            admin_level: rel.admin_level,
            geometry,
        };
        match rel.admin_level {
            4 => provinces.push(area),
            6 | 7 => districts.push(area),
            8 => wards.push(area),
            _ => {}
        }
    }

    info!(
        "spatial index: {} provinces, {} districts, {} wards (skipped {} without polygon)",
        provinces.len(),
        districts.len(),
        wards.len(),
        skipped_no_polygon
    );

    Ok(SpatialIndex {
        provinces: if provinces.is_empty() {
            RTree::new()
        } else {
            RTree::bulk_load(provinces)
        },
        districts: if districts.is_empty() {
            RTree::new()
        } else {
            RTree::bulk_load(districts)
        },
        wards: if wards.is_empty() {
            RTree::new()
        } else {
            RTree::bulk_load(wards)
        },
    })
}

/// Compute a representative point for an admin MultiPolygon (its centroid).
pub fn multipolygon_centroid(geom: &MultiPolygon) -> Option<(f64, f64)> {
    let c = geom.centroid()?;
    Some((c.y(), c.x())) // (lat, lon) — geo Point is (x=lon, y=lat)
}
