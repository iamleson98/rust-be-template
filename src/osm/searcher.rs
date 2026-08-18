//! Smart Google-like search.
//!
//! Behaviour we want to mimic (at a small scale):
//!
//! 1. **Diacritic-insensitive**: typing `"hanoi"`, `"Ha Noi"`, `"Hà Nội"`
//!    should all match the same documents. We pre-normalize the query
//!    via [`vn_text::normalize`](crate::osm::vn_text::normalize)
//!    before parsing.
//! 2. **Cross-field conjunction**: `"Lê Lợi Hà Nội"` should match a street
//!    named "Lê Lợi" whose city is "Hà Nội". We use a multi-field
//!    `QueryParser` in conjunction mode (AND across query tokens, OR across
//!    fields with different boosts).
//! 3. **Prefix / fuzzy**: `"ha no"` should match `"Hà Nội"`. We achieve
//!    this through the `name_ascii_ngram` field (2-3 char n-grams).
//! 4. **Compact form**: typing `"Hanoi"` as a single word should also match
//!    `"Hà Nội"`. We build a separate `TermQuery` against `name_compact`.
//! 5. **House numbers**: `"123 Lê Lợi"` should match POIs/buildings with
//!    `addr:housenumber=123` near `Lê Lợi` street. The `house_number`
//!    field is in the multi-field parser with high boost.
//! 6. **Type-aware ranking**: cities rank above districts, districts above
//!    wards, wards above streets, etc. We re-score hits by `place_kind`.
//!
//! ## Serving model
//!
//! [`PlaceSearcher`] is the long-lived, request-path handle: it keeps the
//! Tantivy [`Index`] + [`IndexReader`] open (the reader reloads
//! automatically on commit via [`ReloadPolicy::OnCommitWithDelay`]) and is
//! stored in [`AppState`](crate::auth::AppState) behind an `Arc`. The
//! one-shot [`search_dir`] helper re-opens the index per call and is meant
//! for CLI / debugging use only.

use crate::osm::schema::SCHEMA;
use crate::osm::{indexer, vn_text};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tantivy::collector::TopDocs;
use tantivy::query::{BooleanQuery, BoostQuery, Occur, Query, QueryParser, RangeQuery, TermQuery};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{Index, IndexReader, ReloadPolicy, Score, TantivyDocument, Term};
use tracing::{debug, info};
use utoipa::ToSchema;

/// A single search hit, ready to be serialized to JSON or printed.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SearchResult {
    pub score: f32,
    pub id: i64,
    pub osm_type: String,
    pub place_kind: String,
    pub admin_level: i64,
    pub name: String,
    pub name_ascii: String,
    pub house_number: Option<String>,
    pub ward: Option<String>,
    pub district: Option<String>,
    pub city: Option<String>,
    pub province: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Haversine distance in km from the reverse-geocode query point.
    /// `None` for fulltext search hits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance_km: Option<f64>,
}

impl SearchResult {
    /// Pull values out of a Tantivy `TantivyDocument`. Missing fields become
    /// `None` / defaults so we never panic on partial documents. If
    /// `query_point` is supplied, the Haversine distance from it is computed
    /// and attached as `distance_km`.
    pub fn from_doc(
        doc: &TantivyDocument,
        raw_score: Score,
        kind_boost: f32,
        query_point: Option<(f64, f64)>,
    ) -> Self {
        let get_text = |field| {
            doc.get_first(field)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };
        let get_i64 = |field| doc.get_first(field).and_then(|v| v.as_i64()).unwrap_or(0);
        let get_f64 = |field| doc.get_first(field).and_then(|v| v.as_f64());

        let lat = get_f64(SCHEMA.lat);
        let lon = get_f64(SCHEMA.lon);
        let distance_km = match (query_point, lat, lon) {
            (Some((qlat, qlon)), Some(lat), Some(lon)) => Some(haversine_km(qlat, qlon, lat, lon)),
            _ => None,
        };

        Self {
            score: raw_score * kind_boost,
            id: get_i64(SCHEMA.id),
            osm_type: get_text(SCHEMA.osm_type).unwrap_or_default(),
            place_kind: get_text(SCHEMA.place_kind).unwrap_or_default(),
            admin_level: get_i64(SCHEMA.admin_level),
            name: get_text(SCHEMA.name).unwrap_or_default(),
            name_ascii: get_text(SCHEMA.name_ascii).unwrap_or_default(),
            house_number: get_text(SCHEMA.house_number),
            ward: get_text(SCHEMA.ward),
            district: get_text(SCHEMA.district),
            city: get_text(SCHEMA.city),
            province: get_text(SCHEMA.province),
            lat,
            lon,
            distance_km,
        }
    }
}

impl std::fmt::Display for SearchResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{:.2}] {}", self.score, self.name)?;
        if let Some(h) = &self.house_number {
            if !h.is_empty() {
                write!(f, " {h}")?;
            }
        }
        // Build the hierarchy parts in order so we can use a clean separator.
        let mut parts: Vec<(&str, &str)> = Vec::new();
        if let Some(w) = &self.ward {
            if !w.is_empty() {
                parts.push(("ward", w.as_str()));
            }
        }
        if let Some(d) = &self.district {
            if !d.is_empty() {
                parts.push(("district", d.as_str()));
            }
        }
        if let Some(c) = &self.city {
            if !c.is_empty() {
                parts.push(("city", c.as_str()));
            }
        }
        if let Some(p) = &self.province {
            if !p.is_empty() {
                parts.push(("province", p.as_str()));
            }
        }
        for (i, (label, value)) in parts.iter().enumerate() {
            let sep = if i == 0 { " • " } else { ", " };
            write!(f, "{sep}{label}: {value}")?;
        }
        write!(
            f,
            "  ({}:{}, kind={})",
            self.osm_type, self.id, self.place_kind
        )?;
        if let (Some(lat), Some(lon)) = (self.lat, self.lon) {
            write!(f, "  @({:.5}, {:.5})", lat, lon)?;
        }
        Ok(())
    }
}

// ── PlaceSearcher (long-lived request-path handle) ──────────────

/// Long-lived place search handle: an open Tantivy [`Index`] plus an
/// [`IndexReader`] that auto-reloads on commit.
///
/// Open once at boot and share via `Arc<PlaceSearcher>` in
/// [`AppState`](crate::auth::AppState). All query methods are synchronous
/// and read-only — they can be called from any thread.
pub struct PlaceSearcher {
    index: Index,
    reader: IndexReader,
}

impl PlaceSearcher {
    /// Open the index at `index_dir`. Fails if the directory holds no index,
    /// or holds an index built by the **legacy** importer (pre-`logic/osm`
    /// schema) — in that case the operator must re-run
    /// `vexevn-backend import-osm`.
    pub fn open(index_dir: &Path) -> Result<Self> {
        let index = indexer::open_or_create_index(index_dir)
            .with_context(|| format!("open place index at {}", index_dir.display()))?;

        // Guard against an index built with an older schema (e.g. the legacy
        // `src/search` importer): field names/types won't line up with
        // `SCHEMA` and queries would fail or return garbage at runtime.
        let on_disk = index.schema();
        for (_, entry) in SCHEMA.schema.fields() {
            if on_disk.get_field(entry.name()).is_err() {
                return Err(anyhow!(
                    "place index at {} was built with an older schema — \
                     re-run `vexevn-backend import-osm` to rebuild it",
                    index_dir.display()
                ));
            }
        }

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .context("build tantivy IndexReader")?;

        Ok(Self { index, reader })
    }

    /// Fulltext search. See the module docs for the matching strategy.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
        // Expand common Vietnamese abbreviations (P. → Phường, Q. → Quận, etc.)
        // BEFORE normalization, so the expanded text is also diacritic-stripped.
        let expanded = vn_text::expand_synonyms(query);
        let normalized = vn_text::normalize(&expanded);
        debug!(raw = %query, expanded = %expanded, normalized = %normalized, "search");

        if normalized.trim().is_empty() {
            return Err(anyhow!("empty query after normalization"));
        }

        let query_boxed = build_query(&self.index, &normalized)?;

        // Custom collector: top-K by raw score, then re-rank by `kind_boost`.
        // Tantivy doesn't let us inject a custom scoring function into the
        // inverted index easily, so we over-fetch (5x) and re-sort in memory.
        let over_fetch = (limit * 5).max(limit + 20);
        let searcher = self.reader.searcher();
        let top_docs: Vec<(Score, tantivy::DocAddress)> =
            searcher.search(&query_boxed, &TopDocs::with_limit(over_fetch))?;

        debug!("raw hits: {}", top_docs.len());
        let raw_hits_count = top_docs.len();

        let mut scored: Vec<SearchResult> = Vec::with_capacity(top_docs.len());
        for (raw_score, addr) in top_docs {
            let doc: TantivyDocument = searcher.doc(addr)?;
            let kind = doc
                .get_first(SCHEMA.place_kind)
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let boost = kind_boost(kind);
            scored.push(SearchResult::from_doc(&doc, raw_score, boost, None));
        }

        // Re-sort by adjusted score and trim to `limit`.
        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(limit);

        info!(
            "query={:?} normalized={:?} hits={} returned={}",
            query,
            normalized,
            raw_hits_count,
            scored.len()
        );

        Ok(scored)
    }

    /// Reverse-geocode: find the `limit` closest places to `(lat, lon)`.
    ///
    /// Tantivy has no native geo type, so we fetch all candidates in a ~50km
    /// bounding box (lat/lon are indexed numeric fields) and sort them in
    /// Rust by the Haversine distance. Hits are returned nearest-first with
    /// `distance_km` set.
    pub fn reverse_geocode(&self, lat: f64, lon: f64, limit: usize) -> Result<Vec<SearchResult>> {
        const BOX_KM: f64 = 50.0;
        // 1° lat ≈ 111 km → 50 km ≈ 0.45°
        let lat_delta = BOX_KM / 111.0;
        // 1° lon ≈ 111 km × cos(lat) → divide by cos to get degrees
        let cos_lat = lat.to_radians().cos().max(0.01);
        let lon_delta = BOX_KM / (111.0 * cos_lat);

        let lat_q = RangeQuery::new_f64_bounds(
            "lat".to_string(),
            std::ops::Bound::Included(lat - lat_delta),
            std::ops::Bound::Included(lat + lat_delta),
        );
        let lon_q = RangeQuery::new_f64_bounds(
            "lon".to_string(),
            std::ops::Bound::Included(lon - lon_delta),
            std::ops::Bound::Included(lon + lon_delta),
        );
        let bool_q = BooleanQuery::new(vec![
            (Occur::Must, Box::new(lat_q)),
            (Occur::Must, Box::new(lon_q)),
        ]);

        let searcher = self.reader.searcher();
        // Fetch a generous candidate pool, then sort in Rust.
        let candidate_cap = (limit * 10).clamp(50, 500);
        let hits: Vec<(Score, tantivy::DocAddress)> =
            searcher.search(&bool_q, &TopDocs::with_limit(candidate_cap))?;

        let mut scored: Vec<(f64, SearchResult)> = Vec::with_capacity(hits.len());
        for (_score, addr) in hits {
            let doc: TantivyDocument = searcher.doc(addr)?;
            let hit = SearchResult::from_doc(&doc, 0.0, 1.0, Some((lat, lon)));
            let d = hit.distance_km.unwrap_or(f64::MAX);
            scored.push((d, hit));
        }
        scored.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored.into_iter().take(limit).map(|(_, h)| h).collect())
    }
}

// ── One-shot helper (CLI / debugging) ───────────────────────────

/// Open the index at `index_dir`, run a single search, and close it again.
/// Re-opens the index on every call — use [`PlaceSearcher`] on the request
/// path instead.
pub fn search_dir(index_dir: &Path, query: &str, limit: usize) -> Result<Vec<SearchResult>> {
    PlaceSearcher::open(index_dir)?.search(query, limit)
}

/// Boost factor applied to raw Tantivy scores based on `place_kind`.
///
/// The intuition: a user searching "Hanoi" probably wants the city, not
/// 500 streets named "Hanoi Road". Cities get a 4x boost, provinces 3x,
/// districts 2x, wards 1.5x, streets 1.0x, POIs 0.7x.
fn kind_boost(kind: &str) -> f32 {
    match kind {
        "city" => 4.0,
        "province" => 3.0,
        "district" => 2.0,
        "ward" => 1.5,
        "village" => 1.2,
        "suburb" => 1.1,
        "street" => 1.0,
        "hamlet" => 1.0,
        "island" => 1.0,
        "poi" => 0.7,
        _ => 0.8,
    }
}

/// Build the main Tantivy query for a normalized user query string.
///
/// Strategy:
/// 1. Parse the normalized query with a multi-field `QueryParser` in
///    conjunction mode (all query tokens must match across the searched
///    fields, with field-specific boosts).
/// 2. Additionally, build a `TermQuery` against `name_compact` using the
///    compact form of the query (e.g. `"hanoi"`). This catches the case
///    where a user types the entire place name as a single word.
/// 3. OR the two together.
fn build_query(index: &Index, normalized_query: &str) -> Result<Box<dyn Query>> {
    let fields = vec![
        SCHEMA.name_ascii,
        SCHEMA.name_ascii_ngram,
        SCHEMA.house_number,
        SCHEMA.ward,
        SCHEMA.district,
        SCHEMA.city,
        SCHEMA.province,
    ];

    let mut parser = QueryParser::for_index(index, fields);
    parser.set_conjunction_by_default();

    // Fuzzy search: 1-edit Levenshtein on the primary name field.
    // This lets "hnoi" match "hanoi", "saigonn" match "saigon", etc.
    // Only on name_ascii (the main field) — n-gram field already
    // provides partial matching; fuzzy on both would be too noisy.
    parser.set_field_fuzzy(SCHEMA.name_ascii, true, 1, false);

    // Field boosts -- higher = more important for ranking.
    parser.set_field_boost(SCHEMA.name_ascii, 3.0);
    parser.set_field_boost(SCHEMA.house_number, 4.0); // exact house-number match is a strong signal
    parser.set_field_boost(SCHEMA.city, 2.5);
    parser.set_field_boost(SCHEMA.district, 2.0);
    parser.set_field_boost(SCHEMA.ward, 1.8);
    parser.set_field_boost(SCHEMA.province, 1.5);
    parser.set_field_boost(SCHEMA.name_ascii_ngram, 0.3); // n-grams are noisy, keep boost low

    // Power users can still use phrase `"..."` and field `field:` syntax in the query.

    let main = parser
        .parse_query(normalized_query)
        .map_err(|e| anyhow!("parse query: {e}"))?;

    // Compact form: collapse all non-alphanumerics out of the query
    // and search it as a single token against `name_compact`.
    let compact = vn_text::compact(normalized_query);
    let compact_q: Option<Box<dyn Query>> = if !compact.is_empty() {
        let term = Term::from_field_text(SCHEMA.name_compact, &compact);
        let inner: Box<dyn Query> = Box::new(TermQuery::new(term, IndexRecordOption::Basic));
        // BoostQuery wraps another query and multiplies its score by a constant.
        let boosted: Box<dyn Query> = Box::new(BoostQuery::new(inner, 5.0));
        Some(boosted)
    } else {
        None
    };

    Ok(match compact_q {
        Some(cq) => Box::new(BooleanQuery::new(vec![
            (Occur::Should, Box::new(main)),
            (Occur::Should, cq),
        ])),
        None => Box::new(main),
    })
}

/// Great-circle distance in km (mirrors `db::util::haversine_km`, kept
/// private here to avoid a cross-module dependency).
fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371.0_f64;
    let to_rad = |x: f64| x * std::f64::consts::PI / 180.0;
    let d_lat = to_rad(lat2 - lat1);
    let d_lon = to_rad(lon2 - lon1);
    let a = (d_lat / 2.0).sin().powi(2)
        + to_rad(lat1).cos() * to_rad(lat2).cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * r * a.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn haversine_km_known_distance_at_equator() {
        let d = haversine_km(0.0, 0.0, 0.0, 1.0);
        // 1° lon at the equator ≈ 111 km.
        assert!((110.0..=112.0).contains(&d), "got {d}");
    }

    #[test]
    fn haversine_km_zero_for_same_point() {
        assert!(haversine_km(10.0, 20.0, 10.0, 20.0).abs() < 1e-9);
    }

    /// Seed a one-document index directly (bypassing the PBF pipeline) so we
    /// can exercise the serving path: open → search → reverse geocode.
    fn seed_hanoi(dir: &Path) {
        let index = indexer::open_or_create_index(dir).unwrap();
        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();

        let name_ascii = vn_text::normalize("Hà Nội");
        let mut d = TantivyDocument::default();
        d.add_i64(SCHEMA.id, 1);
        d.add_text(SCHEMA.osm_type, "node");
        d.add_text(SCHEMA.place_kind, "city");
        d.add_i64(SCHEMA.admin_level, 4);
        d.add_text(SCHEMA.name, "Hà Nội");
        d.add_text(SCHEMA.name_ascii, &name_ascii);
        d.add_text(SCHEMA.name_ascii_ngram, &name_ascii);
        d.add_text(SCHEMA.name_compact, vn_text::compact("Hà Nội"));
        d.add_text(SCHEMA.province, &name_ascii);
        d.add_f64(SCHEMA.lat, 21.0285);
        d.add_f64(SCHEMA.lon, 105.8542);
        writer.add_document(d).unwrap();
        writer.commit().unwrap();
        writer.wait_merging_threads().unwrap();
    }

    #[test]
    fn search_is_diacritic_insensitive_and_supports_prefix() {
        let dir = tempdir().unwrap();
        seed_hanoi(dir.path());
        let s = PlaceSearcher::open(dir.path()).unwrap();

        // Compact one-word form ("hanoi" → "Hà Nội").
        let hits = s.search("hanoi", 10).unwrap();
        assert!(!hits.is_empty(), "compact query should hit");
        assert_eq!(hits[0].name, "Hà Nội");

        // Diacritic form.
        let hits = s.search("Hà Nội", 10).unwrap();
        assert!(!hits.is_empty(), "diacritic query should hit");
        assert_eq!(hits[0].id, 1);

        // Prefix form ("ha no" → "ha noi" via n-grams).
        let hits = s.search("ha no", 10).unwrap();
        assert!(!hits.is_empty(), "prefix query should hit");
    }

    #[test]
    fn reverse_geocode_finds_nearest_with_distance() {
        let dir = tempdir().unwrap();
        seed_hanoi(dir.path());
        let s = PlaceSearcher::open(dir.path()).unwrap();

        let hits = s.reverse_geocode(21.03, 105.85, 5).unwrap();
        assert_eq!(hits.len(), 1, "only Hanoi is indexed");
        assert_eq!(hits[0].id, 1);
        let d = hits[0].distance_km.expect("distance must be set");
        assert!(d < 1.0, "query point is ~200m from the doc, got {d} km");
    }

    #[test]
    fn reverse_geocode_far_from_anything_is_empty() {
        let dir = tempdir().unwrap();
        seed_hanoi(dir.path());
        let s = PlaceSearcher::open(dir.path()).unwrap();
        // (0, 0) is in the ocean, far outside the ~50km box around Hanoi.
        let hits = s.reverse_geocode(0.0, 0.0, 5).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn empty_query_is_an_error() {
        let dir = tempdir().unwrap();
        seed_hanoi(dir.path());
        let s = PlaceSearcher::open(dir.path()).unwrap();
        assert!(s.search("", 10).is_err());
        assert!(s.search("   ", 10).is_err());
    }
}
