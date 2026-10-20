//! Which OSM elements are worth shipping in the travel place index.
//!
//! The backend's Tantivy importer indexes everything with a name or a POI tag
//! (benches, post boxes, buildings, every street). A bus-ticket autocomplete
//! only needs places a traveller names: settlements, administrative areas,
//! stations, airports, ferry terminals and the big attractions.

use std::collections::BTreeMap;

pub type Tags = BTreeMap<String, String>;

/// How much of OSM to ship. Each profile includes the one before it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, clap::ValueEnum)]
pub enum Profile {
    /// Settlements, admin areas, stations, airports, ferry terminals, attractions.
    Travel,
    /// Adds landmarks people give as a destination: hospitals, universities,
    /// markets, malls, pagodas/churches, parks, stadiums, historic sites, beaches.
    Landmarks,
    /// Adds named streets and lodging (hotels, guest houses).
    Full,
}

fn has_name(tags: &Tags) -> bool {
    tags.get("name").is_some_and(|n| !n.trim().is_empty())
}

fn is(tags: &Tags, key: &str, values: &[&str]) -> bool {
    tags.get(key).is_some_and(|v| values.contains(&v.as_str()))
}

/// Kind of a node/way worth indexing, or `None` to skip it.
///
/// Requires an explicit `name` tag: the importer's derived names ("fuel",
/// "bench") are noise in an autocomplete. Administrative boundaries are
/// relations and take a separate path.
pub fn travel_kind(tags: &Tags, profile: Profile) -> Option<&'static str> {
    if !has_name(tags) {
        return None;
    }

    if let Some(place) = tags.get("place") {
        return match place.as_str() {
            "city" | "municipality" => Some("city"),
            "town" => Some("town"),
            "village" => Some("village"),
            "hamlet" => Some("hamlet"),
            "suburb" | "quarter" | "neighbourhood" | "borough" => Some("suburb"),
            "island" | "islet" => Some("island"),
            _ => None,
        };
    }

    // Skip stations that are closed or not in service.
    if tags
        .keys()
        .any(|k| k.starts_with("disused") || k.starts_with("abandoned"))
    {
        return None;
    }

    if is(tags, "railway", &["station", "halt"]) {
        // Metro stops are not intercity stations.
        if is(tags, "station", &["subway", "light_rail", "monorail"]) {
            return None;
        }
        return Some("rail_station");
    }
    if is(tags, "amenity", &["bus_station"]) {
        return Some("bus_station");
    }
    if is(tags, "public_transport", &["station"]) {
        return Some(if is(tags, "train", &["yes"]) {
            "rail_station"
        } else {
            "bus_station"
        });
    }
    if is(tags, "aeroway", &["aerodrome", "terminal"]) {
        return Some("airport");
    }
    if is(tags, "amenity", &["ferry_terminal"]) {
        return Some("ferry_terminal");
    }
    if is(
        tags,
        "tourism",
        &["attraction", "museum", "theme_park", "zoo"],
    ) {
        return Some("attraction");
    }
    if profile >= Profile::Landmarks {
        if let Some(kind) = landmark_kind(tags) {
            return Some(kind);
        }
    }
    if profile >= Profile::Full {
        if let Some(kind) = street_or_lodging_kind(tags) {
            return Some(kind);
        }
    }
    None
}

/// Places a traveller names as "where I'm going" without being a station.
fn landmark_kind(tags: &Tags) -> Option<&'static str> {
    if is(tags, "amenity", &["hospital"]) {
        return Some("amenity_hospital");
    }
    if is(tags, "amenity", &["university"]) {
        return Some("amenity_university");
    }
    if is(tags, "amenity", &["college"]) {
        return Some("amenity_college");
    }
    if is(tags, "amenity", &["marketplace"]) {
        return Some("amenity_marketplace");
    }
    if is(tags, "amenity", &["townhall"]) {
        return Some("amenity_townhall");
    }
    if is(tags, "amenity", &["place_of_worship"]) {
        return Some("worship");
    }
    if is(tags, "shop", &["mall", "supermarket", "department_store"]) {
        return Some("mall");
    }
    if is(
        tags,
        "leisure",
        &["park", "stadium", "water_park", "golf_course"],
    ) {
        return Some("park");
    }
    if is(
        tags,
        "historic",
        &[
            "monument",
            "memorial",
            "castle",
            "ruins",
            "archaeological_site",
            "temple",
            "fort",
        ],
    ) {
        return Some("historic");
    }
    if is(tags, "natural", &["beach", "peak", "bay", "cave_entrance"]) {
        return Some("nature");
    }
    None
}

/// Named streets and places to sleep — the bulk of OSM's named features.
/// Street kinds use the SPA's existing `road_*` vocabulary (and its labels).
fn street_or_lodging_kind(tags: &Tags) -> Option<&'static str> {
    if let Some(highway) = tags.get("highway") {
        let kind = match highway.as_str() {
            "motorway" => "road_motorway",
            "trunk" => "road_trunk",
            "primary" => "road_primary",
            "secondary" => "road_secondary",
            "tertiary" | "unclassified" => "road_tertiary",
            "residential" | "living_street" | "pedestrian" => "road_residential",
            _ => return None,
        };
        return Some(kind);
    }
    if is(
        tags,
        "tourism",
        &["hotel", "resort", "hostel", "guest_house", "motel"],
    ) {
        return Some("lodging");
    }
    None
}

/// Other names people use for the same place ("Hồ Gươm" for Hồ Hoàn Kiếm,
/// "Sài Gòn" for Hồ Chí Minh City): `alt_name`, `short_name`, `old_name`,
/// `official_name`, each possibly `;`-separated. Distinct from `name`, at most 3.
pub fn alt_names(tags: &Tags, name: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for key in ["alt_name", "short_name", "old_name", "official_name"] {
        let Some(value) = tags.get(key) else { continue };
        for part in value.split(';') {
            let part = part.trim();
            if part.is_empty()
                || part.chars().count() > 80
                || part.eq_ignore_ascii_case(name)
                || out.iter().any(|o| o.eq_ignore_ascii_case(part))
            {
                continue;
            }
            out.push(part.to_string());
            if out.len() == 3 {
                return out;
            }
        }
    }
    out
}

/// OSM `population` tags are free text ("1 200 000", "~5000"): keep digits.
pub fn parse_population(tags: &Tags) -> i64 {
    tags.get("population")
        .map(|p| p.chars().filter(char::is_ascii_digit).collect::<String>())
        .and_then(|d| d.parse::<i64>().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn travel_kind_t(t: &Tags) -> Option<&'static str> {
        travel_kind(t, Profile::Travel)
    }

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn keeps_settlements_with_a_name() {
        assert_eq!(
            travel_kind_t(&tags(&[("place", "city"), ("name", "Hà Nội")])),
            Some("city")
        );
        assert_eq!(
            travel_kind_t(&tags(&[("place", "town"), ("name", "Sa Pa")])),
            Some("town")
        );
        assert_eq!(
            travel_kind_t(&tags(&[("place", "locality"), ("name", "x")])),
            None
        );
        assert_eq!(travel_kind_t(&tags(&[("place", "city")])), None);
    }

    #[test]
    fn keeps_intercity_transport_only() {
        assert_eq!(
            travel_kind_t(&tags(&[("railway", "station"), ("name", "Ga Hà Nội")])),
            Some("rail_station")
        );
        assert_eq!(
            travel_kind_t(&tags(&[
                ("railway", "station"),
                ("station", "subway"),
                ("name", "M1")
            ])),
            None
        );
        assert_eq!(
            travel_kind_t(&tags(&[
                ("amenity", "bus_station"),
                ("name", "Bến xe Mỹ Đình")
            ])),
            Some("bus_station")
        );
        assert_eq!(
            travel_kind_t(&tags(&[("aeroway", "aerodrome"), ("name", "Nội Bài")])),
            Some("airport")
        );
        assert_eq!(
            travel_kind_t(&tags(&[
                ("public_transport", "platform"),
                ("name", "Bus stop 12")
            ])),
            None
        );
    }

    #[test]
    fn skips_disused_and_everyday_pois() {
        assert_eq!(
            travel_kind_t(&tags(&[
                ("railway", "station"),
                ("disused:railway", "station"),
                ("name", "Ga cũ")
            ])),
            None
        );
        assert_eq!(
            travel_kind_t(&tags(&[("amenity", "fuel"), ("name", "Petrolimex")])),
            None
        );
        assert_eq!(
            travel_kind_t(&tags(&[("highway", "residential"), ("name", "Lê Lợi")])),
            None
        );
        assert_eq!(
            travel_kind_t(&tags(&[("building", "yes"), ("name", "Nhà A")])),
            None
        );
    }

    #[test]
    fn landmarks_and_streets_only_in_wider_profiles() {
        let hospital = tags(&[("amenity", "hospital"), ("name", "Bệnh viện Chợ Rẫy")]);
        assert_eq!(travel_kind(&hospital, Profile::Travel), None);
        assert_eq!(
            travel_kind(&hospital, Profile::Landmarks),
            Some("amenity_hospital")
        );
        let street = tags(&[("highway", "residential"), ("name", "Lê Lợi")]);
        assert_eq!(travel_kind(&street, Profile::Landmarks), None);
        assert_eq!(
            travel_kind(&street, Profile::Full),
            Some("road_residential")
        );
        let service = tags(&[("highway", "service"), ("name", "Lối vào")]);
        assert_eq!(travel_kind(&service, Profile::Full), None);
        let hotel = tags(&[("tourism", "hotel"), ("name", "Rex")]);
        assert_eq!(travel_kind(&hotel, Profile::Landmarks), None);
        assert_eq!(travel_kind(&hotel, Profile::Full), Some("lodging"));
    }

    #[test]
    fn collects_distinct_alternative_names() {
        let t = tags(&[
            ("name", "Hồ Hoàn Kiếm"),
            ("alt_name", "Hồ Gươm; hồ hoàn kiếm"),
            ("short_name", "Hồ Gươm"),
            ("old_name", "Hồ Lục Thủy"),
        ]);
        assert_eq!(
            alt_names(&t, "Hồ Hoàn Kiếm"),
            vec!["Hồ Gươm".to_string(), "Hồ Lục Thủy".to_string()]
        );
        assert!(alt_names(&tags(&[("name", "x")]), "x").is_empty());
    }

    #[test]
    fn parses_messy_population() {
        assert_eq!(
            parse_population(&tags(&[("population", "1 200 000")])),
            1_200_000
        );
        assert_eq!(parse_population(&tags(&[("population", "~5,000")])), 5000);
        assert_eq!(parse_population(&tags(&[])), 0);
    }
}
