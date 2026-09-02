//! Dev-only helper: builds a small Tantivy place-search index (~30 major
//! Vietnamese cities + a few landmarks) so the modal's full-text search
//! and reverse geocode work in local development without importing a
//! full OSM PBF (`backend import-osm`).
//!
//! Run: `cargo run --bin seed-search-index -- <index-dir>`

use std::path::Path;

use backend::osm::{indexer, schema::SCHEMA, vn_text};
use tantivy::TantivyDocument;

struct Place {
    id: i64,
    kind: &'static str,
    name: &'static str,
    province: &'static str,
    district: Option<&'static str>,
    lat: f64,
    lon: f64,
}

const PLACES: &[Place] = &[
    Place {
        id: 1,
        kind: "city",
        name: "Hà Nội",
        province: "Hà Nội",
        district: None,
        lat: 21.0285,
        lon: 105.8542,
    },
    Place {
        id: 2,
        kind: "city",
        name: "Hồ Chí Minh",
        province: "TP. Hồ Chí Minh",
        district: None,
        lat: 10.7769,
        lon: 106.7009,
    },
    Place {
        id: 3,
        kind: "city",
        name: "Đà Nẵng",
        province: "Đà Nẵng",
        district: None,
        lat: 16.0544,
        lon: 108.2022,
    },
    Place {
        id: 4,
        kind: "city",
        name: "Hải Phòng",
        province: "Hải Phòng",
        district: None,
        lat: 20.8449,
        lon: 106.6881,
    },
    Place {
        id: 5,
        kind: "city",
        name: "Cần Thơ",
        province: "Cần Thơ",
        district: None,
        lat: 10.0452,
        lon: 105.7469,
    },
    Place {
        id: 6,
        kind: "city",
        name: "Bình Dương",
        province: "Bình Dương",
        district: None,
        lat: 11.3254,
        lon: 106.4768,
    },
    Place {
        id: 7,
        kind: "city",
        name: "Đồng Nai",
        province: "Đồng Nai",
        district: None,
        lat: 10.9452,
        lon: 106.8242,
    },
    Place {
        id: 8,
        kind: "city",
        name: "Khánh Hòa",
        province: "Khánh Hòa",
        district: None,
        lat: 12.2388,
        lon: 109.1967,
    },
    Place {
        id: 9,
        kind: "city",
        name: "Nha Trang",
        province: "Khánh Hòa",
        district: None,
        lat: 12.2432,
        lon: 109.1883,
    },
    Place {
        id: 10,
        kind: "city",
        name: "Huế",
        province: "Thừa Thiên Huế",
        district: None,
        lat: 16.4637,
        lon: 107.5909,
    },
    Place {
        id: 11,
        kind: "city",
        name: "Quảng Ninh",
        province: "Quảng Ninh",
        district: None,
        lat: 21.0063,
        lon: 107.2916,
    },
    Place {
        id: 12,
        kind: "bus_station",
        name: "Bến xe Miền Đông",
        province: "TP. Hồ Chí Minh",
        district: Some("Bình Thạnh"),
        lat: 10.8031,
        lon: 106.7117,
    },
    Place {
        id: 13,
        kind: "bus_station",
        name: "Bến xe Giáp Bát",
        province: "Hà Nội",
        district: Some("Hoàng Mai"),
        lat: 20.9599,
        lon: 105.8452,
    },
    Place {
        id: 14,
        kind: "bus_station",
        name: "Bến xe Mỹ Đình",
        province: "Hà Nội",
        district: Some("Nam Từ Liêm"),
        lat: 20.9809,
        lon: 105.7896,
    },
    Place {
        id: 15,
        kind: "bus_station",
        name: "Bến xe Nước Ngầm",
        province: "Hà Nội",
        district: Some("Hoàng Mai"),
        lat: 20.9496,
        lon: 105.8177,
    },
    Place {
        id: 16,
        kind: "bus_station",
        name: "Bến xe Trung tâm Đà Nẵng",
        province: "Đà Nẵng",
        district: None,
        lat: 16.0457,
        lon: 108.1852,
    },
    Place {
        id: 17,
        kind: "airport",
        name: "Sân bay Nội Bài",
        province: "Hà Nội",
        district: None,
        lat: 21.2212,
        lon: 105.8072,
    },
    Place {
        id: 18,
        kind: "airport",
        name: "Sân bay Tân Sơn Nhất",
        province: "TP. Hồ Chí Minh",
        district: None,
        lat: 10.8188,
        lon: 106.6519,
    },
    Place {
        id: 19,
        kind: "city",
        name: "Vũng Tàu",
        province: "Bà Rịa - Vũng Tàu",
        district: None,
        lat: 10.3461,
        lon: 107.0755,
    },
    Place {
        id: 20,
        kind: "city",
        name: "Đà Lạt",
        province: "Lâm Đồng",
        district: None,
        lat: 11.9404,
        lon: 108.4583,
    },
    Place {
        id: 21,
        kind: "city",
        name: "Ninh Bình",
        province: "Ninh Bình",
        district: None,
        lat: 20.2542,
        lon: 105.9752,
    },
    Place {
        id: 22,
        kind: "city",
        name: "Thanh Hóa",
        province: "Thanh Hóa",
        district: None,
        lat: 19.8068,
        lon: 105.7852,
    },
    Place {
        id: 23,
        kind: "city",
        name: "Nghệ An",
        province: "Nghệ An",
        district: None,
        lat: 18.6793,
        lon: 105.6812,
    },
    Place {
        id: 24,
        kind: "city",
        name: "Bình Định",
        province: "Bình Định",
        district: None,
        lat: 13.7824,
        lon: 109.2216,
    },
    Place {
        id: 25,
        kind: "city",
        name: "Gia Lai",
        province: "Gia Lai",
        district: None,
        lat: 13.9827,
        lon: 108.0000,
    },
    Place {
        id: 26,
        kind: "city",
        name: "Lâm Đồng",
        province: "Lâm Đồng",
        district: None,
        lat: 11.7546,
        lon: 108.2522,
    },
    Place {
        id: 27,
        kind: "landmark",
        name: "Chợ Bến Thành",
        province: "TP. Hồ Chí Minh",
        district: Some("Quận 1"),
        lat: 10.7725,
        lon: 106.6981,
    },
    Place {
        id: 28,
        kind: "landmark",
        name: "Hồ Gươm",
        province: "Hà Nội",
        district: Some("Hoàn Kiếm"),
        lat: 21.0287,
        lon: 105.8524,
    },
    Place {
        id: 29,
        kind: "landmark",
        name: "Cầu Rồng",
        province: "Đà Nẵng",
        district: None,
        lat: 16.0649,
        lon: 108.0283,
    },
    Place {
        id: 30,
        kind: "city",
        name: "Quảng Nam",
        province: "Quảng Nam",
        district: None,
        lat: 15.5324,
        lon: 107.9334,
    },
];

fn build_doc(p: &Place) -> TantivyDocument {
    let name_ascii = vn_text::normalize(p.name);
    let province_ascii = vn_text::normalize(p.province);
    let district_ascii = p.district.map(vn_text::normalize);

    let mut d = TantivyDocument::default();
    d.add_i64(SCHEMA.id, p.id);
    d.add_text(SCHEMA.osm_type, "node");
    d.add_text(SCHEMA.place_kind, p.kind);
    d.add_i64(SCHEMA.admin_level, if p.kind == "city" { 6 } else { 15 });
    d.add_text(SCHEMA.name, p.name);
    d.add_text(SCHEMA.name_ascii, &name_ascii);
    d.add_text(SCHEMA.name_ascii_ngram, &name_ascii);
    d.add_text(SCHEMA.name_compact, vn_text::compact(p.name));
    d.add_text(SCHEMA.province, &province_ascii);
    if let Some(district) = district_ascii {
        d.add_text(SCHEMA.district, &district);
    }
    d.add_f64(SCHEMA.lat, p.lat);
    d.add_f64(SCHEMA.lon, p.lon);
    d
}

fn main() -> anyhow::Result<()> {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "./search-index".into());
    let path = Path::new(&dir);
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }

    let index = indexer::open_or_create_index(path)?;
    let mut writer = index.writer_with_num_threads(1, 15_000_000)?;

    for p in PLACES {
        writer.add_document(build_doc(p))?;
    }
    writer.commit()?;
    writer.wait_merging_threads()?;

    println!("Seeded {} places into {dir}", PLACES.len());
    Ok(())
}
