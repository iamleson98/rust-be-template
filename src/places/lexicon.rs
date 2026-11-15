//! Vietnamese place vocabulary: the words that name a TYPE of place, what
//! kind of place each one asks for, and the short forms people type.
//!
//! Every entry is in folded form (lower case, no tones): it is compared with
//! the output of [`super::text::tokens`].

/// A road kind of the extractor (`road_motorway`, `road_residential`, …).
pub const ROAD: &str = "road_";

/// Type phrases a query may START with ("Bến xe Mỹ Đình", "Ga Hà Nội",
/// "Phường Bến Nghé"): they ask for that kind of place, and they are
/// optional, because OpenStreetMap often names the station "Hà Nội" rather
/// than "Ga Hà Nội". Longest phrase first wins.
pub const TYPE_PHRASES: &[(&[&str], &[&str])] = &[
    (&["trung", "tam", "thuong", "mai"], &["mall"]),
    (
        &["truong", "dai", "hoc"],
        &["amenity_university", "amenity_college"],
    ),
    (&["thanh", "pho"], &["city", "province"]),
    (&["thi", "xa"], &["town", "district"]),
    (&["thi", "tran"], &["town", "ward"]),
    (&["ben", "xe"], &["bus_station"]),
    (&["san", "bay"], &["airport"]),
    (&["ben", "tau"], &["ferry_terminal"]),
    (&["ben", "pha"], &["ferry_terminal"]),
    (&["benh", "vien"], &["amenity_hospital"]),
    (&["dai", "hoc"], &["amenity_university", "amenity_college"]),
    (&["cao", "dang"], &["amenity_college"]),
    (&["khach", "san"], &["lodging"]),
    (&["sieu", "thi"], &["mall"]),
    (&["nha", "tho"], &["worship"]),
    (&["cong", "vien"], &["park"]),
    (&["bai", "bien"], &["nature"]),
    (&["ga"], &["rail_station"]),
    (&["bx"], &["bus_station"]),
    (&["sb"], &["airport"]),
    (&["cang"], &["ferry_terminal"]),
    (&["bv"], &["amenity_hospital"]),
    (&["dh"], &["amenity_university", "amenity_college"]),
    (&["ks"], &["lodging"]),
    (&["cho"], &["amenity_marketplace"]),
    (&["chua"], &["worship"]),
    (&["duong"], &[ROAD]),
    (&["pho"], &[ROAD]),
    (&["tp"], &["city", "province"]),
    (&["tx"], &["town", "district"]),
    (&["tt"], &["town", "ward"]),
    (&["tinh"], &["province"]),
    (&["quan"], &["district"]),
    (&["huyen"], &["district"]),
    (&["phuong"], &["ward", "suburb"]),
    (&["xa"], &["ward", "village"]),
];

/// Administrative words that are optional ANYWHERE in a query ("Cầu Giấy,
/// thành phố Hà Nội"): addresses spell them out or leave them off at will.
pub const ADMIN_PHRASES: &[&[&str]] = &[
    &["thanh", "pho"],
    &["thi", "xa"],
    &["thi", "tran"],
    &["tp"],
    &["tx"],
    &["tt"],
    &["tinh"],
    &["quan"],
    &["huyen"],
    &["phuong"],
    &["xa"],
];

/// Short forms people type for a longer name. Added to the index next to the
/// words they stand for, so "hcm" finds everything in Hồ Chí Minh.
pub const SHORT_FORMS: &[(&[&str], &[&str])] = &[
    (
        &["ho", "chi", "minh"],
        &["hcm", "tphcm", "sg", "saigon", "sgn"],
    ),
    (&["ha", "noi"], &["hn"]),
    (&["ben", "xe"], &["bx"]),
    (&["san", "bay"], &["sb"]),
    (&["benh", "vien"], &["bv"]),
    (&["dai", "hoc"], &["dh"]),
    (&["khu", "cong", "nghiep"], &["kcn"]),
    (&["khach", "san"], &["ks"]),
    (&["thanh", "pho"], &["tp"]),
    (&["thi", "xa"], &["tx"]),
    (&["thi", "tran"], &["tt"]),
    (&["trung", "tam", "thuong", "mai"], &["tttm"]),
];

/// "Quận 1" → "q1", "Phường 12" → "p12": numbered districts and wards are
/// typed run together.
pub const NUMBERED: &[(&str, &str)] = &[("quan", "q"), ("phuong", "p")];

/// Length of the longest phrase of `phrases` that `tokens` starts with.
pub fn phrase_at<'a, T: AsRef<str>>(
    tokens: &[T],
    phrases: impl IntoIterator<Item = &'a [&'a str]>,
) -> usize {
    phrases
        .into_iter()
        .filter(|p| p.len() <= tokens.len() && p.iter().zip(tokens).all(|(a, b)| *a == b.as_ref()))
        .map(|p| p.len())
        .max()
        .unwrap_or(0)
}

/// Does a place of `kind` satisfy one of the `wanted` kinds?
pub fn kind_matches(kind: &str, wanted: &[&str]) -> bool {
    wanted
        .iter()
        .any(|w| kind == *w || (*w == ROAD && kind.starts_with(ROAD)))
}

/// Ranking weight of a kind of place, 0..1: what a traveller most likely means.
pub fn kind_weight(kind: &str) -> f32 {
    match kind {
        "city" => 1.0,
        "province" => 0.95,
        "airport" => 0.9,
        "town" => 0.85,
        "rail_station" | "bus_station" => 0.8,
        "ferry_terminal" | "district" => 0.7,
        "island" => 0.65,
        "attraction" | "amenity_hospital" | "amenity_university" => 0.6,
        "nature" | "historic" => 0.55,
        "park"
        | "mall"
        | "amenity_marketplace"
        | "amenity_college"
        | "road_motorway"
        | "road_trunk" => 0.5,
        "worship" | "amenity_townhall" | "ward" | "suburb" | "road_primary" => 0.45,
        "road_secondary" => 0.4,
        "village" | "road_tertiary" | "lodging" => 0.35,
        "road_residential" => 0.3,
        "hamlet" => 0.25,
        k if k.starts_with("amenity_") => 0.2,
        k if k.starts_with("tourism_") || k.starts_with("leisure_") => 0.2,
        k if k.starts_with("landuse_")
            || k.starts_with("waterway_")
            || k.starts_with("natural_") =>
        {
            0.18
        }
        k if k.starts_with("shop_") || k.starts_with("office_") || k.starts_with("craft_") => 0.15,
        k if k.starts_with("public_transport_")
            || k.starts_with("railway_")
            || k.starts_with("building")
            || k.starts_with("man_made_") =>
        {
            0.1
        }
        "address" | "place_other" => 0.1,
        k if k.starts_with("highway_") => 0.08,
        _ => 0.12,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_longest_leading_phrase() {
        let q = ["thanh", "pho", "ha", "noi"];
        assert_eq!(phrase_at(&q, TYPE_PHRASES.iter().map(|(p, _)| *p)), 2);
        assert_eq!(
            phrase_at(&["ha", "noi"], TYPE_PHRASES.iter().map(|(p, _)| *p)),
            0
        );
        assert_eq!(phrase_at(&["thi", "xa"], ADMIN_PHRASES.iter().copied()), 2);
    }

    #[test]
    fn road_kinds_match_the_road_family() {
        assert!(kind_matches("road_primary", &[ROAD]));
        assert!(kind_matches("bus_station", &["bus_station"]));
        assert!(!kind_matches("bus_station", &[ROAD]));
    }
}
