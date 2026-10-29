//! Raw extractor rows → the places a search engine serves: province names
//! mapped onto the app's own list (`cloudflare/src/lib/cities.json`), one
//! entry per real place, and nothing outside the served provinces.
//!
//! Same rules as `cloudflare/src/lib/places/build.ts` (`canonicalize` +
//! `dedupe`), which still builds the Worker's static fallback shards; the
//! record layout is that index's `PlaceRecord` too.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::extract::RawPlace;
use crate::osm::vn_text;

/// Two entries with the same name closer than this are the same place.
const DUPLICATE_DEG: f64 = 0.1;
/// A province boundary's centroid sits far from its city's node: merge them anyway.
const PROVINCE_TWIN_DEG: f64 = 1.0;

/// One served place. Serialised as the positional array of the static index
/// (`[id, name, kind, province, district, ward, lat, lon, population, alt]`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(from = "RecordRow", into = "RecordRow")]
pub struct PlaceRecord {
    /// OSM type letter + id: "n123", "w45", "r6".
    pub id: String,
    pub name: String,
    pub kind: String,
    pub province: String,
    pub district: String,
    pub ward: String,
    pub lat: f64,
    pub lon: f64,
    pub population: i64,
    /// Other names for the same place (searchable, never displayed).
    pub alt_names: Vec<String>,
}

type RecordRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    f64,
    f64,
    i64,
    String,
);

impl From<RecordRow> for PlaceRecord {
    fn from(r: RecordRow) -> Self {
        PlaceRecord {
            id: r.0,
            name: r.1,
            kind: r.2,
            province: r.3,
            district: r.4,
            ward: r.5,
            lat: r.6,
            lon: r.7,
            population: r.8,
            alt_names: r
                .9
                .split(';')
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect(),
        }
    }
}

impl From<PlaceRecord> for RecordRow {
    fn from(p: PlaceRecord) -> Self {
        (
            p.id,
            p.name,
            p.kind,
            p.province,
            p.district,
            p.ward,
            p.lat,
            p.lon,
            p.population,
            p.alt_names.join(";"),
        )
    }
}

#[derive(Debug, Clone, Default)]
pub struct Prepared {
    pub records: Vec<PlaceRecord>,
    /// Rows discarded because they are not in a province the app serves.
    pub dropped: usize,
}

#[derive(Deserialize)]
struct City {
    name: String,
    #[serde(default)]
    aliases: Vec<String>,
}

/// Lower-case, diacritic-free, single-spaced ("Hà  Nội" → "ha noi").
pub fn fold(s: &str) -> String {
    vn_text::normalize(s)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// "Tỉnh An Giang" / "Thành phố Hà Nội" / "TP. Hồ Chí Minh" → "an giang" / …
fn province_key(name: &str) -> String {
    let f = fold(name);
    for prefix in ["tinh ", "thanh pho ", "tp. ", "tp "] {
        if let Some(rest) = f.strip_prefix(prefix) {
            return rest.trim().to_string();
        }
    }
    f
}

static PROVINCES: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    let cities: Vec<City> =
        serde_json::from_str(include_str!("../../../cloudflare/src/lib/cities.json"))
            .expect("cloudflare/src/lib/cities.json is a list of { name }");
    let mut map = HashMap::new();
    // Aliases first, so a province's own name always wins a clash. They
    // matter where a city became the province: OSM now says "Thành phố Huế"
    // for what the list calls "Thừa Thiên Huế" (alias "Huế").
    for c in &cities {
        for alias in &c.aliases {
            map.insert(province_key(alias), c.name.clone());
        }
    }
    for c in cities {
        map.insert(province_key(&c.name), c.name);
    }
    map
});

/// The app's own spelling of a province (OSM says "Tỉnh Lâm Đồng", the city
/// list and the trip search say "Lâm Đồng"), or `None` when it is not one of
/// the served provinces — which is how foreign border areas in the extract
/// and unmappable points are recognised.
pub fn canonical_province(name: Option<&str>) -> Option<String> {
    PROVINCES.get(&province_key(name?)).cloned()
}

/// Higher wins when the same place appears as several OSM elements.
pub fn kind_priority(kind: &str) -> f64 {
    match kind {
        "city" => 10.0,
        "town" => 9.0,
        "province" => 8.0,
        "rail_station" | "bus_station" | "airport" => 7.0,
        "ferry_terminal" => 6.0,
        "amenity_hospital" | "amenity_university" | "district" | "road_motorway" | "road_trunk" => {
            5.0
        }
        "amenity_college" | "amenity_marketplace" | "island" | "attraction" | "road_primary" => 4.0,
        "mall" | "park" | "historic" | "nature" | "worship" | "amenity_townhall" | "ward"
        | "suburb" | "road_secondary" => 3.0,
        "road_tertiary" | "lodging" | "village" => 2.0,
        "road_residential" | "hamlet" => 1.0,
        k if k.starts_with("amenity_") => 2.0,
        k if k.starts_with("shop_")
            || k.starts_with("office_")
            || k.starts_with("landuse_")
            || k.starts_with("waterway_") =>
        {
            1.5
        }
        k if k.starts_with("public_transport_") || k.starts_with("building") => 1.0,
        k if k.starts_with("address") => 0.5,
        _ => 0.0,
    }
}

/// Settlements and admin areas describe the same place; stations etc. do not.
pub fn is_area(kind: &str) -> bool {
    matches!(
        kind,
        "city"
            | "town"
            | "province"
            | "district"
            | "ward"
            | "suburb"
            | "village"
            | "hamlet"
            | "island"
    )
}

fn same_class(a: &str, b: &str) -> bool {
    (is_area(a) && is_area(b))
        // One street, many segments.
        || (a.starts_with("road_") && b.starts_with("road_"))
        || a == b
}

/// Rewrites province spellings to the app's own. A province that is not one
/// of ours stays `None` (and is filtered out after de-duplication, so a point
/// can still borrow its province from a twin element).
fn canonicalize(mut p: RawPlace) -> Option<RawPlace> {
    if p.kind == "province" {
        let own = canonical_province(Some(&p.name))?;
        p.name = own.clone();
        p.province = Some(own);
        return Some(p);
    }
    p.province = canonical_province(p.province.as_deref());
    Some(p)
}

/// The same city is usually both a `place=city` node and an administrative
/// relation (and sometimes a way too). Keep one entry per (name, area): the
/// highest-priority kind, carrying the largest population seen.
pub fn dedupe(places: impl IntoIterator<Item = RawPlace>) -> Vec<RawPlace> {
    let mut by_name: HashMap<String, Vec<RawPlace>> = HashMap::new();
    for p in places {
        let name = fold(&p.name);
        if name.is_empty() || !p.lat.is_finite() || !p.lon.is_finite() {
            continue;
        }
        by_name.entry(name).or_default().push(p);
    }
    let mut kept: Vec<RawPlace> = Vec::new();
    for mut group in by_name.into_values() {
        // Best candidates first so they absorb the weaker duplicates. A stable
        // sort keeps input order between equals.
        group.sort_by(|a, b| {
            kind_priority(&b.kind)
                .total_cmp(&kind_priority(&a.kind))
                .then(b.population.cmp(&a.population))
        });
        let mut survivors: Vec<RawPlace> = Vec::new();
        for p in group {
            let twin = survivors.iter_mut().find(|s| {
                // A railway station called "Hà Nội" is not the city of Hà Nội.
                if !same_class(&s.kind, &p.kind) {
                    return false;
                }
                let reach = if s.kind == "province" || p.kind == "province" {
                    PROVINCE_TWIN_DEG
                } else {
                    DUPLICATE_DEG
                };
                (s.lat - p.lat).abs() < reach && (s.lon - p.lon).abs() < reach
            });
            match twin {
                Some(twin) => {
                    twin.population = twin.population.max(p.population);
                    for alt in p.alt_names {
                        if !twin.alt_names.contains(&alt) {
                            twin.alt_names.push(alt);
                        }
                    }
                    // The weaker element may know the address context the winner lacks.
                    twin.province = twin.province.take().or(p.province);
                    twin.district = twin.district.take().or(p.district);
                    twin.ward = twin.ward.take().or(p.ward);
                }
                None => survivors.push(p),
            }
        }
        kept.extend(survivors);
    }
    // Deterministic output: identical input must give identical records.
    kept.sort_by(|a, b| {
        type_rank(a)
            .cmp(&type_rank(b))
            .then(a.osm_id.cmp(&b.osm_id))
    });
    kept
}

/// The static builder sorts by the type's name: "node" < "relation" < "way".
fn type_rank(p: &RawPlace) -> u8 {
    match p.osm_type {
        crate::OsmType::Node => 0,
        crate::OsmType::Relation => 1,
        crate::OsmType::Way => 2,
    }
}

fn round5(x: f64) -> f64 {
    (x * 1e5).round() / 1e5
}

fn to_record(p: RawPlace) -> PlaceRecord {
    PlaceRecord {
        id: format!("{}{}", p.osm_type.letter(), p.osm_id),
        name: p.name.trim().to_string(),
        kind: p.kind,
        province: p.province.unwrap_or_default(),
        district: p.district.unwrap_or_default(),
        ward: p.ward.unwrap_or_default(),
        lat: round5(p.lat),
        lon: round5(p.lon),
        population: p.population.max(0),
        alt_names: p.alt_names,
    }
}

/// Canonicalise provinces, merge duplicates, drop what the app does not serve.
///
/// Takes the rows as a stream: only the grouped rows are ever held, never a
/// second full copy of the extractor's output.
pub fn prepare(raw: impl IntoIterator<Item = RawPlace>) -> Prepared {
    let mut foreign_provinces = 0;
    let merged = dedupe(raw.into_iter().filter_map(|p| {
        let kept = canonicalize(p);
        foreign_provinces += usize::from(kept.is_none());
        kept
    }));
    let merged_len = merged.len();
    let records: Vec<PlaceRecord> = merged
        .into_iter()
        .filter(|p| p.province.is_some())
        .map(to_record)
        .collect();
    Prepared {
        dropped: foreign_provinces + (merged_len - records.len()),
        records,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::OsmType;
    use std::sync::atomic::{AtomicI64, Ordering};

    static NEXT_ID: AtomicI64 = AtomicI64::new(1);

    fn place(name: &str, kind: &str, province: Option<&str>, lat: f64, lon: f64) -> RawPlace {
        RawPlace {
            osm_id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            osm_type: OsmType::Node,
            kind: kind.to_string(),
            name: name.to_string(),
            alt_names: Vec::new(),
            province: province.map(str::to_string),
            district: None,
            ward: None,
            lat,
            lon,
            population: 0,
        }
    }

    #[test]
    fn maps_osm_province_spellings_onto_the_app_list() {
        assert_eq!(
            canonical_province(Some("Tỉnh Lâm Đồng")).as_deref(),
            Some("Lâm Đồng")
        );
        assert_eq!(
            canonical_province(Some("Thành phố Hà Nội")).as_deref(),
            Some("Hà Nội")
        );
        assert!(canonical_province(Some("Thành phố Hồ Chí Minh"))
            .unwrap()
            .ends_with("Hồ Chí Minh"));
        // A city that became the province, known to the list by its alias.
        assert_eq!(
            canonical_province(Some("Thành phố Huế")).as_deref(),
            Some("Thừa Thiên Huế")
        );
        assert_eq!(
            canonical_province(Some("Tỉnh Hưng Yên")).as_deref(),
            Some("Hưng Yên")
        );
        assert_eq!(canonical_province(Some("广西壮族自治区")), None);
        assert_eq!(canonical_province(Some("Palawan")), None);
        assert_eq!(canonical_province(None), None);
    }

    #[test]
    fn merges_a_city_node_and_its_relation() {
        let mut city = place("Hà Nội", "city", Some("Thành phố Hà Nội"), 21.03, 105.85);
        city.population = 8_000_000;
        let mut rel = place(
            "Hà Nội",
            "province",
            Some("Thành phố Hà Nội"),
            21.04,
            105.84,
        );
        rel.osm_type = OsmType::Relation;
        let station = place(
            "Hà Nội",
            "rail_station",
            Some("Thành phố Hà Nội"),
            21.02,
            105.84,
        );
        let merged = dedupe(vec![rel, city, station]);
        assert_eq!(merged.len(), 2);
        let hanoi = merged.iter().find(|p| p.kind != "rail_station").unwrap();
        assert_eq!(hanoi.kind, "city");
        assert_eq!(hanoi.population, 8_000_000);
    }

    #[test]
    fn drops_places_outside_the_served_provinces() {
        let out = prepare(vec![
            place("Đà Lạt", "city", Some("Tỉnh Lâm Đồng"), 11.94, 108.44),
            place("Bằng Tường", "city", Some("广西壮族自治区"), 22.1, 106.8),
            place(
                "广西壮族自治区",
                "province",
                Some("广西壮族自治区"),
                23.0,
                108.0,
            ),
            place("Lost point", "city", None, 10.0, 106.0),
        ]);
        assert_eq!(out.records.len(), 1);
        assert_eq!(out.records[0].province, "Lâm Đồng");
        assert_eq!(out.dropped, 3);
    }

    #[test]
    fn a_point_borrows_its_province_from_a_twin() {
        let out = prepare(vec![
            place("Sa Pa", "town", None, 22.34, 103.84),
            place("Sa Pa", "ward", Some("Tỉnh Lào Cai"), 22.33, 103.85),
        ]);
        assert_eq!(out.records.len(), 1);
        assert_eq!(out.records[0].kind, "town");
        assert_eq!(out.records[0].province, "Lào Cai");
    }

    #[test]
    fn keeps_far_apart_namesakes_and_rejects_bad_coordinates() {
        let merged = dedupe(vec![
            place("Tân Phú", "ward", Some("Hà Nội"), 10.79, 106.62),
            place("Tân Phú", "ward", Some("Hà Nội"), 11.3, 107.4),
            place("Nowhere", "ward", Some("Hà Nội"), f64::NAN, 1.0),
        ]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn merges_one_streets_segments_keeping_the_higher_class() {
        let merged = dedupe(vec![
            place(
                "Đường Nguyễn Huệ",
                "road_residential",
                Some("Hà Nội"),
                10.7747,
                106.7038,
            ),
            place(
                "Đường Nguyễn Huệ",
                "road_primary",
                Some("Hà Nội"),
                10.7745,
                106.7036,
            ),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].kind, "road_primary");
    }

    #[test]
    fn records_round_trip_as_positional_arrays() {
        let rec = PlaceRecord {
            id: "n1".into(),
            name: "Hồ Hoàn Kiếm".into(),
            kind: "nature".into(),
            province: "Hà Nội".into(),
            district: String::new(),
            ward: String::new(),
            lat: 21.0288,
            lon: 105.8523,
            population: 0,
            alt_names: vec!["Hồ Gươm".into(), "Hồ Lục Thủy".into()],
        };
        let json = serde_json::to_string(&rec).unwrap();
        assert_eq!(
            json,
            r#"["n1","Hồ Hoàn Kiếm","nature","Hà Nội","","",21.0288,105.8523,0,"Hồ Gươm;Hồ Lục Thủy"]"#
        );
        assert_eq!(serde_json::from_str::<PlaceRecord>(&json).unwrap(), rec);
    }
}
