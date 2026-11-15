//! Search behaviour on a small fixture. The same cases the Worker's static
//! index is held to (cloudflare/tests/unit/places.test.ts), plus what this
//! engine adds: typos, short forms, intent, tones and the "near" bias.

use place_extract::PlaceRecord;

use super::{Engine, PlaceHit, SearchOptions};

#[allow(clippy::too_many_arguments)]
fn rec(
    id: &str,
    name: &str,
    kind: &str,
    province: &str,
    district: &str,
    lat: f64,
    lon: f64,
    population: i64,
) -> PlaceRecord {
    PlaceRecord {
        id: id.into(),
        name: name.into(),
        kind: kind.into(),
        province: province.into(),
        district: district.into(),
        ward: String::new(),
        lat,
        lon,
        population,
        alt_names: Vec::new(),
    }
}

fn fixture() -> Engine {
    let mut lake = rec(
        "w10",
        "Hồ Hoàn Kiếm",
        "nature",
        "Hà Nội",
        "Hoàn Kiếm",
        21.0288,
        105.8523,
        0,
    );
    lake.alt_names = vec!["Hồ Gươm".into()];
    let records = vec![
        rec(
            "n1",
            "Hà Nội",
            "city",
            "Hà Nội",
            "",
            21.03,
            105.85,
            8_000_000,
        ),
        rec(
            "n2",
            "Hải Phòng",
            "city",
            "Hải Phòng",
            "",
            20.86,
            106.68,
            2_000_000,
        ),
        rec(
            "n3",
            "Bến xe Mỹ Đình",
            "bus_station",
            "Hà Nội",
            "Nam Từ Liêm",
            21.028,
            105.78,
            0,
        ),
        rec(
            "n4",
            "Bến xe Giáp Bát",
            "bus_station",
            "Hà Nội",
            "Hoàng Mai",
            20.98,
            105.84,
            0,
        ),
        rec(
            "n5",
            "Hà Nội",
            "rail_station",
            "Hà Nội",
            "Hoàn Kiếm",
            21.024,
            105.841,
            0,
        ),
        rec(
            "n6",
            "Sân bay Nội Bài",
            "airport",
            "Hà Nội",
            "Sóc Sơn",
            21.22,
            105.8,
            0,
        ),
        rec(
            "r7",
            "Phường Bến Nghé",
            "ward",
            "TP. Hồ Chí Minh",
            "Quận 1",
            10.78,
            106.7,
            0,
        ),
        rec(
            "n8",
            "Đà Lạt",
            "city",
            "Lâm Đồng",
            "",
            11.94,
            108.44,
            400_000,
        ),
        lake,
        rec(
            "w11",
            "Bệnh viện Chợ Rẫy",
            "amenity_hospital",
            "TP. Hồ Chí Minh",
            "Quận 5",
            10.7576,
            106.6595,
            0,
        ),
        rec(
            "w12",
            "Đường Nguyễn Huệ",
            "road_primary",
            "TP. Hồ Chí Minh",
            "Quận 1",
            10.7745,
            106.7036,
            0,
        ),
        rec(
            "w13",
            "Đường Trần Phú",
            "road_primary",
            "Khánh Hòa",
            "Thành phố Nha Trang",
            12.24,
            109.196,
            0,
        ),
        rec(
            "w14",
            "Đường Trần Phú",
            "road_secondary",
            "Hà Nội",
            "Ba Đình",
            21.032,
            105.84,
            0,
        ),
        rec(
            "n15",
            "Nha Trang",
            "city",
            "Khánh Hòa",
            "",
            12.2388,
            109.1967,
            400_000,
        ),
        rec(
            "n16",
            "Hạ Long",
            "city",
            "Quảng Ninh",
            "",
            20.95,
            107.07,
            300_000,
        ),
        rec("n17", "Hà Long", "village", "Thanh Hóa", "", 19.8, 105.7, 0),
        rec(
            "r18",
            "Quận 1",
            "district",
            "TP. Hồ Chí Minh",
            "",
            10.776,
            106.7,
            0,
        ),
        rec(
            "n19",
            "Thành phố Hồ Chí Minh",
            "city",
            "TP. Hồ Chí Minh",
            "",
            10.776,
            106.7,
            9_000_000,
        ),
        rec(
            "w20",
            "Đường Lê Lợi",
            "road_primary",
            "TP. Hồ Chí Minh",
            "Quận 1",
            10.773,
            106.7,
            0,
        ),
        rec(
            "w21",
            "Đường Lê Lợi",
            "road_primary",
            "Thanh Hóa",
            "Thành phố Thanh Hóa",
            19.8,
            105.77,
            0,
        ),
        rec(
            "n22",
            "Bình Dương",
            "province",
            "Bình Dương",
            "",
            11.1,
            106.65,
            2_500_000,
        ),
        rec(
            "w23",
            "Đường Bình Dương",
            "road_residential",
            "Bình Dương",
            "Thủ Dầu Một",
            10.98,
            106.65,
            0,
        ),
    ];
    Engine::build(records, "t")
}

fn search(e: &Engine, q: &str) -> Vec<PlaceHit> {
    e.search(
        q,
        &SearchOptions {
            limit: 10,
            near: None,
        },
    )
}

fn top(e: &Engine, q: &str) -> String {
    search(e, q)
        .first()
        .map(|h| h.name.clone())
        .unwrap_or_default()
}

fn top_id(e: &Engine, q: &str) -> String {
    search(e, q)
        .first()
        .map(|h| h.id.clone())
        .unwrap_or_default()
}

#[test]
fn finds_a_place_regardless_of_tones_case_and_spacing() {
    let e = fixture();
    for q in ["Hà Nội", "ha noi", "HANOI", "hà nội", "hanoi"] {
        assert_eq!(top_id(&e, q), "n1", "{q}");
    }
}

#[test]
fn finds_multi_word_names_typed_as_one_word_and_back() {
    let e = fixture();
    assert_eq!(top(&e, "benxemydinh"), "Bến xe Mỹ Đình");
    assert_eq!(top(&e, "ben xe my dinh"), "Bến xe Mỹ Đình");
    assert_eq!(top(&e, "mydinh"), "Bến xe Mỹ Đình");
}

#[test]
fn matches_prefixes_while_typing() {
    let e = fixture();
    assert_eq!(top(&e, "bến xe mỹ"), "Bến xe Mỹ Đình");
    assert_eq!(top(&e, "hai ph"), "Hải Phòng");
    assert_eq!(top(&e, "nha tr"), "Nha Trang");
    let one_letter = search(&e, "h");
    assert_eq!(
        one_letter[0].kind, "city",
        "one letter: the most important places"
    );
}

#[test]
fn finds_alternative_names_but_shows_the_main_one() {
    let e = fixture();
    let hits = search(&e, "ho guom");
    assert_eq!(hits[0].name, "Hồ Hoàn Kiếm");
    assert_eq!(hits[0].kind, "nature");
    assert_eq!(top(&e, "hoguom"), "Hồ Hoàn Kiếm");
    assert_eq!(top(&e, "ho hoan kiem"), "Hồ Hoàn Kiếm");
}

#[test]
fn type_words_are_optional_and_set_the_intent() {
    let e = fixture();
    assert_eq!(top_id(&e, "ga ha noi"), "n5", "the station, not the city");
    assert_eq!(top_id(&e, "thanh pho ha noi"), "n1");
    assert_eq!(top(&e, "san bay noi bai"), "Sân bay Nội Bài");
    assert_eq!(top(&e, "sb noi bai"), "Sân bay Nội Bài");
    // A query of only type words still has to match them.
    let only = search(&e, "ben xe");
    assert!(!only.is_empty());
    assert!(only.iter().all(|h| h.kind == "bus_station"));
}

#[test]
fn context_only_matches_never_outrank_the_place_itself() {
    let e = fixture();
    assert_eq!(top_id(&e, "ho chi minh"), "n19");
    assert_eq!(top_id(&e, "hcm"), "n19");
    assert_eq!(top_id(&e, "tp hcm"), "n19");
    assert_eq!(top_id(&e, "sai gon"), "n19");
}

#[test]
fn uses_the_address_context_to_tell_namesakes_apart() {
    let e = fixture();
    assert_eq!(top_id(&e, "tran phu nha trang"), "w13");
    assert_eq!(top_id(&e, "tran phu ba dinh"), "w14");
    assert_eq!(top_id(&e, "le loi thanh hoa"), "w21");
    assert_eq!(top_id(&e, "le loi q1"), "w20");
    assert_eq!(top_id(&e, "le loi quan 1"), "w20");
    let stations = search(&e, "bến xe hà nội");
    let mut first_two: Vec<&str> = stations[..2].iter().map(|h| h.name.as_str()).collect();
    first_two.sort();
    assert_eq!(first_two, ["Bến xe Giáp Bát", "Bến xe Mỹ Đình"]);
    assert_eq!(
        search(&e, "ben xe hoang mai")
            .iter()
            .map(|h| h.name.as_str())
            .collect::<Vec<_>>(),
        ["Bến xe Giáp Bát"]
    );
}

#[test]
fn a_word_inside_a_name_is_not_a_type_word() {
    let e = fixture();
    // "Dương" folds to "duong" like "Đường" (street), but here it is part of the name.
    assert_eq!(top_id(&e, "binh duong"), "n22");
    assert_eq!(top_id(&e, "duong binh duong"), "w23");
}

#[test]
fn tolerates_typos() {
    let e = fixture();
    assert_eq!(top_id(&e, "hanio"), "n1");
    assert_eq!(top(&e, "nguyen hu"), "Đường Nguyễn Huệ");
    assert_eq!(top(&e, "nguyne hue"), "Đường Nguyễn Huệ");
    assert_eq!(top(&e, "benh vien cho rayy"), "Bệnh viện Chợ Rẫy");
}

#[test]
fn tones_break_ties_between_namesakes() {
    let e = fixture();
    assert_eq!(top(&e, "hạ long"), "Hạ Long");
    assert_eq!(top(&e, "hà long"), "Hà Long");
    // Without tones the bigger place wins.
    assert_eq!(top(&e, "ha long"), "Hạ Long");
}

#[test]
fn expands_abbreviations_and_numbered_districts() {
    let e = fixture();
    assert_eq!(top(&e, "P. Bến Nghé"), "Phường Bến Nghé");
    assert_eq!(top(&e, "p. ben nghe"), "Phường Bến Nghé");
    assert_eq!(top(&e, "ben nghe"), "Phường Bến Nghé");
    assert_eq!(top_id(&e, "q1"), "r18");
    assert_eq!(top_id(&e, "quan 1"), "r18");
}

#[test]
fn finds_streets_with_or_without_their_type_word() {
    let e = fixture();
    assert_eq!(top_id(&e, "duong le loi"), "w20");
    assert_eq!(top_id(&e, "le loi"), "w20");
}

#[test]
fn near_biases_toward_the_users_area() {
    let e = fixture();
    let hanoi = Some((21.03, 105.85));
    let nha_trang = Some((12.24, 109.19));
    let at = |near| {
        e.search("tran phu", &SearchOptions { limit: 5, near })[0]
            .id
            .clone()
    };
    assert_eq!(at(hanoi), "w14");
    assert_eq!(at(nha_trang), "w13");
}

#[test]
fn honest_empty_results() {
    let e = fixture();
    assert!(search(&e, "").is_empty());
    assert!(search(&e, "?!").is_empty());
    assert!(search(&e, "qwertyuiop").is_empty());
    assert!(
        search(&e, "zzzzzz da lat").is_empty(),
        "every word must match"
    );
    assert_eq!(top(&e, "da lat"), "Đà Lạt");
    assert_eq!(
        e.search(
            "ben",
            &SearchOptions {
                limit: 1,
                near: None
            }
        )
        .len(),
        1
    );
}

#[test]
fn hit_shape_is_the_apps_api() {
    let e = fixture();
    let hit = &search(&e, "ha noi")[0];
    let json = serde_json::to_value(hit).unwrap();
    assert_eq!(json["name"], "Hà Nội");
    assert_eq!(json["nameNoTones"], "ha noi");
    assert_eq!(json["type"], "city");
    assert_eq!(json["province"], "Hà Nội");
    assert_eq!(json["district"], serde_json::Value::Null);
    assert_eq!(json["lat"], 21.03);
}

#[test]
fn reverse_geocodes_to_the_nearest_area() {
    let e = fixture();
    let hits = e.reverse(21.028, 105.78, 3);
    assert_eq!(hits[0].name, "Hà Nội");
    assert!(hits
        .iter()
        .all(|h| !["bus_station", "airport", "rail_station"].contains(&h.kind.as_str())));
    // Across a grid-cell boundary (21.0 is one).
    assert!(e
        .reverse(20.999, 105.85, 5)
        .iter()
        .any(|h| h.name == "Hà Nội"));
    assert!(e.reverse(0.0, 0.0, 5).is_empty());
    assert!(e.reverse(f64::NAN, 0.0, 5).is_empty());
}

#[test]
fn popular_lists_the_biggest_cities() {
    let e = fixture();
    let names: Vec<String> = e.popular(0, 3).into_iter().map(|h| h.name).collect();
    assert_eq!(names, ["Thành phố Hồ Chí Minh", "Hà Nội", "Hải Phòng"]);
    assert_eq!(e.popular(1, 1)[0].name, "Hà Nội");
}
