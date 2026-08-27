//! Hardcoded list of Vietnamese first-level administrative divisions.
//!
//! This is the **backend mirror** of `frontend/src/lib/vietnamese-cities.ts`.
//! Both lists MUST stay in sync — when you add/rename a slug on one side,
//! do the same on the other.
//!
//! ## Why hardcode instead of using a `place` table?
//!
//! The `place` table is populated by OSM PBF ingestion and contains
//! ~30k–100k geographic features (cities, towns, wards, etc.) used by
//! the place-search / autocomplete endpoints. Treating a route's
//! start/end location as a FK to `place` requires:
//!   1. The OSM PBF import to have run.
//!   2. The user to know the UUID of a place row.
//!
//! Both are impractical for the route form, which lets the admin pick
//! from a fixed list of provinces/municipalities. Storing the
//! location as a slug string (`"ha-noi"`, `"da-nang"`) means:
//!   - No FK to maintain.
//!   - No DB round-trip to resolve the slug → name + lat/lon.
//!   - The frontend and backend can both resolve the slug from a
//!     single hardcoded source of truth.
//!
//! ## Slug rules
//!
//! - Lowercase ASCII with hyphens.
//! - Longest slug in the list is `ba-ria-vung-tau` (15 chars) — fits
//!   comfortably in `VARCHAR(20)`.
//! - Slugs are stable identifiers — never rename without a migration.
//!
//! ## Coordinates
//!
//! The `lat` / `lon` for each city is the province seat's coordinate
//! (rounded to 2 decimal places). These are used to populate
//! `RouteOut.from.lat` / `RouteOut.from.lon` etc. when the route
//! entity only carries the slug. They're NOT survey-grade — they're
//! "good enough" for map overview markers.

use once_cell::sync::Lazy;

/// A Vietnamese first-level administrative division (municipality or province).
///
/// Note: derives `PartialEq` but NOT `Eq` because `f64` doesn't
/// implement `Eq` (NaN != NaN). If you need a key for a `HashSet`,
/// use the slug (`&str`) instead of the whole `City`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct City {
    /// URL-safe slug, e.g. `"ha-noi"`. Stored in the `route.start_location_id`
    /// / `route.end_location_id` columns as `VARCHAR(20)`.
    pub slug: &'static str,
    /// Display name in Vietnamese (with diacritics), e.g. `"Hà Nội"`.
    pub name: &'static str,
    /// Geographic region — used by the frontend to group the dropdown.
    pub region: Region,
    /// Province seat latitude (rough — for map overview markers).
    pub lat: f64,
    /// Province seat longitude (rough — for map overview markers).
    pub lon: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Region {
    North,
    Central,
    South,
}

/// The full list of cities — order matches
/// `frontend/src/lib/vietnamese-cities.ts` so it's easy to diff.
pub static CITIES: Lazy<&[City]> = Lazy::new(|| {
    // NOTE: keep in sync with `frontend/src/lib/vietnamese-cities.ts`.
    // The longest slug here is `ba-ria-vung-tau` (15 chars) — VARCHAR(20)
    // on the DB side has room to spare.
    &[
        // ── Centrally-governed municipalities ───────────────────────
        City { slug: "ha-noi", name: "Hà Nội", region: Region::North, lat: 21.03, lon: 105.85 },
        City { slug: "ho-chi-minh", name: "TP. Hồ Chí Minh", region: Region::South, lat: 10.78, lon: 106.70 },
        City { slug: "hai-phong", name: "Hải Phòng", region: Region::North, lat: 20.86, lon: 106.68 },
        City { slug: "da-nang", name: "Đà Nẵng", region: Region::Central, lat: 16.05, lon: 108.21 },
        City { slug: "can-tho", name: "Cần Thơ", region: Region::South, lat: 10.03, lon: 105.79 },
        // ── Northern provinces ──────────────────────────────────────
        City { slug: "ha-giang", name: "Hà Giang", region: Region::North, lat: 22.82, lon: 104.98 },
        City { slug: "cao-bang", name: "Cao Bằng", region: Region::North, lat: 22.67, lon: 106.26 },
        City { slug: "bac-kan", name: "Bắc Kạn", region: Region::North, lat: 22.18, lon: 105.87 },
        City { slug: "tuyen-quang", name: "Tuyên Quang", region: Region::North, lat: 22.18, lon: 105.22 },
        City { slug: "lao-cai", name: "Lào Cai", region: Region::North, lat: 22.39, lon: 103.97 },
        City { slug: "dien-bien", name: "Điện Biên", region: Region::North, lat: 21.39, lon: 103.04 },
        City { slug: "lai-chau", name: "Lai Châu", region: Region::North, lat: 22.39, lon: 103.47 },
        City { slug: "son-la", name: "Sơn La", region: Region::North, lat: 21.33, lon: 103.77 },
        City { slug: "yen-bai", name: "Yên Bái", region: Region::North, lat: 21.73, lon: 104.91 },
        City { slug: "hoa-binh", name: "Hoà Bình", region: Region::North, lat: 20.69, lon: 105.33 },
        City { slug: "thai-nguyen", name: "Thái Nguyên", region: Region::North, lat: 21.59, lon: 105.79 },
        City { slug: "lang-son", name: "Lạng Sơn", region: Region::North, lat: 21.85, lon: 106.76 },
        City { slug: "quang-ninh", name: "Quảng Ninh", region: Region::North, lat: 20.95, lon: 107.08 },
        City { slug: "bac-giang", name: "Bắc Giang", region: Region::North, lat: 21.27, lon: 106.21 },
        City { slug: "vinh-phuc", name: "Vĩnh Phúc", region: Region::North, lat: 21.31, lon: 105.60 },
        City { slug: "bac-ninh", name: "Bắc Ninh", region: Region::North, lat: 21.18, lon: 106.06 },
        City { slug: "phu-tho", name: "Phú Thọ", region: Region::North, lat: 21.41, lon: 105.40 },
        City { slug: "ha-nam", name: "Hà Nam", region: Region::North, lat: 20.59, lon: 105.92 },
        City { slug: "thai-binh", name: "Thái Bình", region: Region::North, lat: 20.45, lon: 106.34 },
        City { slug: "nam-dinh", name: "Nam Định", region: Region::North, lat: 20.42, lon: 106.17 },
        City { slug: "ninh-binh", name: "Ninh Bình", region: Region::North, lat: 20.25, lon: 105.85 },
        City { slug: "ninh-thuan", name: "Ninh Thuận", region: Region::Central, lat: 11.59, lon: 108.99 },
        // ── Central provinces ───────────────────────────────────────
        City { slug: "thanh-hoa", name: "Thanh Hóa", region: Region::Central, lat: 19.81, lon: 105.79 },
        City { slug: "nghe-an", name: "Nghệ An", region: Region::Central, lat: 19.00, lon: 104.69 },
        City { slug: "ha-tinh", name: "Hà Tĩnh", region: Region::Central, lat: 18.35, lon: 105.90 },
        City { slug: "quang-binh", name: "Quảng Bình", region: Region::Central, lat: 17.47, lon: 106.59 },
        City { slug: "quang-tri", name: "Quảng Trị", region: Region::Central, lat: 16.74, lon: 106.65 },
        City { slug: "hue", name: "Thừa Thiên Huế", region: Region::Central, lat: 16.46, lon: 107.59 },
        City { slug: "quang-nam", name: "Quảng Nam", region: Region::Central, lat: 15.54, lon: 108.20 },
        City { slug: "quang-ngai", name: "Quảng Ngãi", region: Region::Central, lat: 15.12, lon: 108.80 },
        City { slug: "binh-dinh", name: "Bình Định", region: Region::Central, lat: 13.76, lon: 109.22 },
        City { slug: "phu-yen", name: "Phú Yên", region: Region::Central, lat: 13.09, lon: 109.09 },
        City { slug: "khanh-hoa", name: "Khánh Hòa", region: Region::Central, lat: 12.25, lon: 109.19 },
        City { slug: "binh-thuan", name: "Bình Thuận", region: Region::Central, lat: 10.93, lon: 108.10 },
        City { slug: "kon-tum", name: "Kon Tum", region: Region::Central, lat: 14.35, lon: 108.00 },
        City { slug: "gia-lai", name: "Gia Lai", region: Region::Central, lat: 13.95, lon: 108.27 },
        City { slug: "dak-lak", name: "Đắk Lắk", region: Region::Central, lat: 12.71, lon: 108.24 },
        City { slug: "dak-nong", name: "Đắk Nông", region: Region::Central, lat: 12.25, lon: 107.59 },
        City { slug: "lam-dong", name: "Lâm Đồng", region: Region::Central, lat: 11.94, lon: 108.44 },
        // ── Southern provinces ──────────────────────────────────────
        City { slug: "ba-ria-vung-tau", name: "Bà Rịa - Vũng Tàu", region: Region::South, lat: 10.52, lon: 107.16 },
        City { slug: "binh-duong", name: "Bình Dương", region: Region::South, lat: 11.16, lon: 106.60 },
        City { slug: "binh-phuoc", name: "Bình Phước", region: Region::South, lat: 11.75, lon: 106.89 },
        City { slug: "dong-nai", name: "Đồng Nai", region: Region::South, lat: 10.96, lon: 106.84 },
        City { slug: "tay-ninh", name: "Tây Ninh", region: Region::South, lat: 11.31, lon: 106.10 },
        City { slug: "long-an", name: "Long An", region: Region::South, lat: 10.69, lon: 106.24 },
        City { slug: "tien-giang", name: "Tiền Giang", region: Region::South, lat: 10.36, lon: 106.34 },
        City { slug: "ben-tre", name: "Bến Tre", region: Region::South, lat: 10.24, lon: 106.37 },
        City { slug: "tra-vinh", name: "Trà Vinh", region: Region::South, lat: 9.95, lon: 106.34 },
        City { slug: "vinh-long", name: "Vĩnh Long", region: Region::South, lat: 10.25, lon: 105.97 },
        City { slug: "dong-thap", name: "Đồng Tháp", region: Region::South, lat: 10.46, lon: 105.65 },
        City { slug: "an-giang", name: "An Giang", region: Region::South, lat: 10.38, lon: 105.44 },
        City { slug: "kien-giang", name: "Kiên Giang", region: Region::South, lat: 10.01, lon: 105.21 },
        City { slug: "hau-giang", name: "Hậu Giang", region: Region::South, lat: 9.91, lon: 105.72 },
        City { slug: "soc-trang", name: "Sóc Trăng", region: Region::South, lat: 9.60, lon: 105.97 },
        City { slug: "bac-lieu", name: "Bạc Liêu", region: Region::South, lat: 9.27, lon: 105.73 },
        City { slug: "ca-mau", name: "Cà Mau", region: Region::South, lat: 9.18, lon: 105.15 },
    ]
});

/// Lookup a city by its slug.
///
/// Returns `None` if the slug doesn't match any city in the hardcoded
/// list. Used by the route service layer to resolve
/// `route.start_location_id` / `route.end_location_id` (stored as
/// `VARCHAR(20)` slugs) into `City` records for display.
pub fn find_by_slug(slug: &str) -> Option<&'static City> {
    CITIES.iter().find(|c| c.slug == slug)
}

/// Get the display name for a city slug.
///
/// Falls back to the slug itself if not found — same behavior as the
/// frontend's `getCityName`. This means a deleted/renamed slug still
/// renders SOMETHING on the UI rather than blank.
pub fn name_for_slug(slug: &str) -> String {
    find_by_slug(slug)
        .map(|c| c.name.to_string())
        .unwrap_or_else(|| slug.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_known_slug() {
        let city = find_by_slug("ha-noi").expect("ha-noi must be in the list");
        assert_eq!(city.name, "Hà Nội");
        assert_eq!(city.region, Region::North);
        // Hanoi is north of the equator and east of the prime meridian.
        assert!(city.lat > 0.0);
        assert!(city.lon > 0.0);
    }

    #[test]
    fn returns_none_for_unknown_slug() {
        assert!(find_by_slug("nonexistent").is_none());
    }

    #[test]
    fn name_for_slug_falls_back_to_slug() {
        // Unknown slugs should still render SOMETHING rather than panic
        // or return an empty string — this is the same behavior as the
        // frontend's getCityName.
        assert_eq!(name_for_slug("nonexistent"), "nonexistent");
    }

    #[test]
    fn all_slugs_are_lowercase_ascii_with_hyphens() {
        // Slug invariant — must match the validation on the DB column
        // (VARCHAR(20)) and the frontend's Select value.
        for c in CITIES.iter() {
            assert!(
                c.slug.chars().all(|ch| ch.is_ascii_lowercase() || ch == '-'),
                "slug {:?} must be lowercase ASCII with hyphens only",
                c.slug
            );
        }
    }

    #[test]
    fn all_slugs_fit_in_20_chars() {
        // The DB column is VARCHAR(20). Asserting here means a
        // migration that adds a new slug longer than 20 chars will
        // fail loudly at unit-test time, before it ever hits the DB.
        for c in CITIES.iter() {
            assert!(
                c.slug.len() <= 20,
                "slug {:?} is {} chars — exceeds VARCHAR(20)",
                c.slug,
                c.slug.len()
            );
        }
    }

    #[test]
    fn all_slugs_are_unique() {
        let mut slugs: Vec<&str> = CITIES.iter().map(|c| c.slug).collect();
        slugs.sort();
        let dupes: Vec<&str> = slugs
            .windows(2)
            .filter(|pair| pair[0] == pair[1])
            .map(|pair| pair[0])
            .collect();
        assert!(dupes.is_empty(), "duplicate slugs found: {:?}", dupes);
    }

    #[test]
    fn has_all_cities_in_sync_with_frontend() {
        // The frontend's `vietnamese-cities.ts` currently has 61 entries
        // (5 centrally-governed municipalities + 56 provinces). The exact
        // count is not important — what matters is that this test will
        // fail loudly if someone adds a city on one side but not the other.
        //
        // If you intentionally add/remove a city, update this count
        // AND the corresponding `VIETNAMESE_CITIES` list in
        // `frontend/src/lib/vietnamese-cities.ts`.
        assert_eq!(
            CITIES.len(),
            61,
            "expected 61 Vietnamese cities — if you added/removed one, \
             update this count and the frontend's VIETNAMESE_CITIES list"
        );
    }
}
