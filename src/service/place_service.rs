//! Place service — business logic for place listing, search, and reverse geocoding.
//!
//! Ported from `booking-rs/logic/places.rs`, adapted to the template's
//! store + `AppError` architecture.
//!
//! ## Design
//! - Uses `CompositeStore` (PlaceStore) for all DB access.
//! - When a Tantivy [`PlaceSearcher`](crate::osm::searcher::PlaceSearcher)
//!   is available (built via `import-osm`), fulltext search + reverse
//!   geocoding use it for Vietnamese-aware, diacritic-insensitive matching.
//! - Falls back to store `LIKE` queries when no index is configured.
//! - Returns typed DTOs from [`crate::dto::place`] (no `serde_json::Value`).

use std::sync::Arc;

use crate::dto::place::{
    PlaceListResponse, PlaceOut, PlaceReverseResponse, PlaceSearchHit, PlaceSearchResponse,
};
use crate::error::{AppError, AppResult};
use crate::osm::searcher::PlaceSearcher;
use crate::store::CompositeStore;

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct PlaceService {
    store: Arc<CompositeStore>,
    /// Optional Tantivy place-search index. `None` when no index directory
    /// is configured (place search falls back to SQL `LIKE`).
    searcher: Option<Arc<PlaceSearcher>>,
}

impl PlaceService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self {
            store,
            searcher: None,
        }
    }

    /// Construct with an optional Tantivy place-search index.
    pub fn with_searcher(store: Arc<CompositeStore>, searcher: Option<Arc<PlaceSearcher>>) -> Self {
        Self { store, searcher }
    }

    /// True when the Tantivy fulltext index is available.
    pub fn has_search_index(&self) -> bool {
        self.searcher.is_some()
    }

    // ── List ────────────────────────────────────────────────────

    /// List the most popular places (for the map view).
    pub async fn list(&self, limit: u64, offset: u64) -> AppResult<PlaceListResponse> {
        let limit = limit.clamp(1, 200);
        let places = self
            .store
            .place_store()
            .list_places(limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items = places
            .iter()
            .map(|p| PlaceOut {
                id: p.id,
                name: p.name.clone(),
                kind: p.r#type.clone(),
                province: p.province.clone(),
                lat: p.lat,
                lon: p.lon,
                population: p.population,
            })
            .collect();
        Ok(PlaceListResponse { items })
    }

    // ── Search (basic LIKE-based autocomplete) ──────────────────

    /// Autocomplete places by name (case-insensitive LIKE).
    ///
    /// This is a simplified version that uses store `LIKE` queries
    /// instead of Tantivy fulltext search. For production use with
    /// large place datasets, consider integrating Tantivy or Meilisearch.
    pub async fn search(
        &self,
        query: &str,
        limit: u64,
        lat: Option<f64>,
        lon: Option<f64>,
    ) -> AppResult<PlaceSearchResponse> {
        let q_trim = query.trim();
        if q_trim.is_empty() {
            return Ok(PlaceSearchResponse {
                items: Vec::new(),
                engine: None,
            });
        }
        let limit = limit.clamp(1, 50);

        // ── Tantivy fulltext path (preferred when an index is configured) ──
        if let Some(searcher) = &self.searcher {
            // Tantivy search is CPU-bound (10-200ms on a 1M+ doc index).
            // Run on the blocking-pool thread so we don't stall the tokio
            // worker. Cloning `Arc<PlaceSearcher>` is a refcount bump.
            let searcher = searcher.clone();
            let q = q_trim.to_string();
            let results = tokio::task::spawn_blocking(move || searcher.search(&q, limit as usize))
                .await
                .map_err(|e| AppError::Internal(format!("search join: {e}")))?
                .map_err(|e| AppError::Internal(format!("place search: {e}")))?;
            let items = results
                .into_iter()
                .map(|r| PlaceSearchHit {
                    id: None,
                    osm_id: Some(r.id),
                    name: r.name,
                    place_kind: Some(r.place_kind),
                    kind: None,
                    house_number: r.house_number,
                    ward: r.ward,
                    district: r.district,
                    city: r.city,
                    province: r.province,
                    lat: r.lat,
                    lon: r.lon,
                    score: Some(r.score),
                    distance_km: r.distance_km,
                })
                .collect();
            return Ok(PlaceSearchResponse {
                items,
                engine: Some("tantivy".to_string()),
            });
        }

        // ── SQL LIKE fallback ─────────────────────────────────────────────
        let pattern = format!("%{q_trim}%");
        let mut places = self
            .store
            .place_store()
            .search_places_by_name(&pattern, limit * 5)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Also search by name_no_tones for Vietnamese accent-insensitive matching
        let pattern_no_tones = format!("%{}%", remove_vietnamese_tones(q_trim));
        let places_no_tones = self
            .store
            .place_store()
            .search_places_by_name_no_tones(&pattern_no_tones, limit * 5)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Merge and deduplicate
        let mut seen = std::collections::HashSet::new();
        for p in &places_no_tones {
            if seen.insert(p.id) {
                places.push(p.clone());
            }
        }

        // Geo-bias re-ranking if lat/lon provided
        if let (Some(src_lat), Some(src_lon)) = (lat, lon) {
            places.sort_by(|a, b| {
                let da = haversine_km(src_lat, src_lon, a.lat, a.lon);
                let db = haversine_km(src_lat, src_lon, b.lat, b.lon);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        let items = places
            .into_iter()
            .take(limit as usize)
            .map(|p| PlaceSearchHit {
                id: Some(p.id),
                osm_id: p.osm_id.into(),
                name: p.name,
                place_kind: None,
                kind: Some(p.r#type),
                house_number: None,
                ward: p.ward,
                district: p.district,
                city: None,
                province: p.province,
                lat: Some(p.lat),
                lon: Some(p.lon),
                score: None,
                distance_km: None,
            })
            .collect();
        Ok(PlaceSearchResponse {
            items,
            engine: None,
        })
    }

    // ── Reverse geocode ─────────────────────────────────────────

    /// Find the nearest places to `(lat, lon)`.
    ///
    /// Uses a simple bounding-box + sort approach. For production,
    /// consider PostGIS or a dedicated geocoding service.
    pub async fn reverse(&self, lat: f64, lon: f64, limit: u64) -> AppResult<PlaceReverseResponse> {
        let limit = limit.clamp(1, 50);

        // ── Tantivy reverse-geocode path (preferred) ──────────────────────
        if let Some(searcher) = &self.searcher {
            let searcher = searcher.clone();
            let results = tokio::task::spawn_blocking(move || {
                searcher.reverse_geocode(lat, lon, limit as usize)
            })
            .await
            .map_err(|e| AppError::Internal(format!("reverse join: {e}")))?
            .map_err(|e| AppError::Internal(format!("reverse geocode: {e}")))?;
            let items = results
                .into_iter()
                .map(|r| PlaceSearchHit {
                    id: None,
                    osm_id: Some(r.id),
                    name: r.name,
                    place_kind: Some(r.place_kind),
                    kind: None,
                    house_number: None,
                    ward: r.ward,
                    district: r.district,
                    city: r.city,
                    province: r.province,
                    lat: r.lat,
                    lon: r.lon,
                    score: None,
                    distance_km: r.distance_km,
                })
                .collect();
            return Ok(items);
        }

        // ── SQL bounding-box fallback ─────────────────────────────────────
        let places = self
            .store
            .place_store()
            .search_places_in_bbox(lat, lon, 200)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut with_dist: Vec<(_, _)> = places
            .into_iter()
            .map(|p| {
                let d = haversine_km(lat, lon, p.lat, p.lon);
                (p, d)
            })
            .collect();
        with_dist.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        let items = with_dist
            .into_iter()
            .take(limit as usize)
            .map(|(p, dist)| PlaceSearchHit {
                id: Some(p.id),
                osm_id: p.osm_id.into(),
                name: p.name,
                place_kind: None,
                kind: Some(p.r#type),
                house_number: None,
                ward: p.ward,
                district: p.district,
                city: None,
                province: p.province,
                lat: Some(p.lat),
                lon: Some(p.lon),
                score: None,
                distance_km: Some((dist * 10.0).round() / 10.0), // 1 decimal
            })
            .collect();
        Ok(items)
    }
}

// ────────────────────────────────────────────────────────────────
//  Pure helpers
// ────────────────────────────────────────────────────────────────

/// Haversine distance in kilometers between two lat/lon points.
fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371.0; // Earth radius in km
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    r * c
}

/// Remove Vietnamese diacritical marks for accent-insensitive search.
fn remove_vietnamese_tones(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        let replacement = match c {
            'á' | 'à' | 'ả' | 'ã' | 'ạ' | 'ă' | 'ắ' | 'ằ' | 'ẳ' | 'ẵ' | 'ặ' | 'â' | 'ấ' | 'ầ'
            | 'ẩ' | 'ẫ' | 'ậ' => 'a',
            'é' | 'è' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ế' | 'ề' | 'ể' | 'ễ' | 'ệ' => {
                'e'
            }
            'í' | 'ì' | 'ỉ' | 'ĩ' | 'ị' => 'i',
            'ó' | 'ò' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ố' | 'ồ' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ớ' | 'ờ'
            | 'ở' | 'ỡ' | 'ợ' => 'o',
            'ú' | 'ù' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ứ' | 'ừ' | 'ử' | 'ữ' | 'ự' => {
                'u'
            }
            'ý' | 'ỳ' | 'ỷ' | 'ỹ' | 'ỵ' => 'y',
            'đ' => 'd',
            'Á' | 'À' | 'Ả' | 'Ã' | 'Ạ' | 'Ă' | 'Ắ' | 'Ằ' | 'Ẳ' | 'Ẵ' | 'Ặ' | 'Â' | 'Ấ' | 'Ầ'
            | 'Ẩ' | 'Ẫ' | 'Ậ' => 'A',
            'É' | 'È' | 'Ẻ' | 'Ẽ' | 'Ẹ' | 'Ê' | 'Ế' | 'Ề' | 'Ể' | 'Ễ' | 'Ệ' => {
                'E'
            }
            'Í' | 'Ì' | 'Ỉ' | 'Ĩ' | 'Ị' => 'I',
            'Ó' | 'Ò' | 'Ỏ' | 'Õ' | 'Ọ' | 'Ô' | 'Ố' | 'Ồ' | 'Ổ' | 'Ỗ' | 'Ộ' | 'Ơ' | 'Ớ' | 'Ờ'
            | 'Ở' | 'Ỡ' | 'Ợ' => 'O',
            'Ú' | 'Ù' | 'Ủ' | 'Ũ' | 'Ụ' | 'Ư' | 'Ứ' | 'Ừ' | 'Ử' | 'Ữ' | 'Ự' => {
                'U'
            }
            'Ý' | 'Ỳ' | 'Ỷ' | 'Ỹ' | 'Ỵ' => 'Y',
            'Đ' => 'D',
            _ => c,
        };
        result.push(replacement);
    }
    result
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_same_point_is_zero() {
        let d = haversine_km(21.0, 105.0, 21.0, 105.0);
        assert!(d < 0.001);
    }

    #[test]
    fn haversine_hanoi_to_da_nang() {
        // Hanoi: 21.0285, 105.8542
        // Da Nang: 16.0544, 108.2022
        // Approx 600-650 km
        let d = haversine_km(21.0285, 105.8542, 16.0544, 108.2022);
        assert!(d > 550.0 && d < 700.0, "distance was {d}");
    }

    #[test]
    fn remove_vietnamese_tones_basic() {
        assert_eq!(remove_vietnamese_tones("Hà Nội"), "Ha Noi");
        assert_eq!(remove_vietnamese_tones("Đà Nẵng"), "Da Nang");
        assert_eq!(
            remove_vietnamese_tones("TP. Hồ Chí Minh"),
            "TP. Ho Chi Minh"
        );
    }

    #[test]
    fn remove_vietnamese_tones_preserves_ascii() {
        assert_eq!(remove_vietnamese_tones("hello world"), "hello world");
    }
}
