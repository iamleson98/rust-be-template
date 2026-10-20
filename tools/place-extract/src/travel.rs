//! Which OSM elements are worth shipping in the travel place index.
//!
//! The backend's Tantivy importer indexes everything with a name or a POI tag
//! (benches, post boxes, buildings, every street). A bus-ticket autocomplete
//! only needs places a traveller names: settlements, administrative areas,
//! stations, airports, ferry terminals and the big attractions.

use std::collections::BTreeMap;

pub type Tags = BTreeMap<String, String>;

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
pub fn travel_kind(tags: &Tags) -> Option<&'static str> {
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
        return Some("train_station");
    }
    if is(tags, "amenity", &["bus_station"]) {
        return Some("bus_station");
    }
    if is(tags, "public_transport", &["station"]) {
        return Some(if is(tags, "train", &["yes"]) {
            "train_station"
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
    None
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

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn keeps_settlements_with_a_name() {
        assert_eq!(
            travel_kind(&tags(&[("place", "city"), ("name", "Hà Nội")])),
            Some("city")
        );
        assert_eq!(
            travel_kind(&tags(&[("place", "town"), ("name", "Sa Pa")])),
            Some("town")
        );
        assert_eq!(
            travel_kind(&tags(&[("place", "locality"), ("name", "x")])),
            None
        );
        assert_eq!(travel_kind(&tags(&[("place", "city")])), None);
    }

    #[test]
    fn keeps_intercity_transport_only() {
        assert_eq!(
            travel_kind(&tags(&[("railway", "station"), ("name", "Ga Hà Nội")])),
            Some("train_station")
        );
        assert_eq!(
            travel_kind(&tags(&[
                ("railway", "station"),
                ("station", "subway"),
                ("name", "M1")
            ])),
            None
        );
        assert_eq!(
            travel_kind(&tags(&[
                ("amenity", "bus_station"),
                ("name", "Bến xe Mỹ Đình")
            ])),
            Some("bus_station")
        );
        assert_eq!(
            travel_kind(&tags(&[("aeroway", "aerodrome"), ("name", "Nội Bài")])),
            Some("airport")
        );
        assert_eq!(
            travel_kind(&tags(&[
                ("public_transport", "platform"),
                ("name", "Bus stop 12")
            ])),
            None
        );
    }

    #[test]
    fn skips_disused_and_everyday_pois() {
        assert_eq!(
            travel_kind(&tags(&[
                ("railway", "station"),
                ("disused:railway", "station"),
                ("name", "Ga cũ")
            ])),
            None
        );
        assert_eq!(
            travel_kind(&tags(&[("amenity", "fuel"), ("name", "Petrolimex")])),
            None
        );
        assert_eq!(
            travel_kind(&tags(&[("highway", "residential"), ("name", "Lê Lợi")])),
            None
        );
        assert_eq!(
            travel_kind(&tags(&[("building", "yes"), ("name", "Nhà A")])),
            None
        );
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
