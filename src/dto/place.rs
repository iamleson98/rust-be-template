//! DTOs for the place service (`/api/places`, `/api/places/search`,
//! `/api/places/reverse`).
//!
//! The place service has two output shapes:
//! 1. The "DB place" — a row from the `place` table, used by `list`.
//! 2. The "search hit" — a Tantivy / SQL LIKE match, used by `search`
//!    and `reverse`. Carries optional geo-context (distance, score).

use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// A place row from the database, as returned by `GET /api/places`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlaceOut {
    pub id: Uuid,
    pub name: String,
    /// OSM place kind (city / town / village / suburb ...). Mirrors the
    /// DB column `place.type` (renamed because `type` is a Rust keyword).
    #[serde(rename = "type")]
    pub kind: String,
    pub province: Option<String>,
    pub lat: f64,
    pub lon: f64,
    pub population: i64,
}

/// Optional fields populated by the Tantivy fulltext index. Present on
/// `PlaceSearchHit` but NOT on `PlaceOut` (which comes from the DB).

/// A search hit returned by `GET /api/places/search?q=`.
///
/// When the Tantivy index is configured, fields like `osmId`, `ward`,
/// `district`, `city`, `score`, `distanceKm` are populated. When the
/// SQL LIKE fallback is used, only the DB-backed fields are set.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlaceSearchHit {
    /// DB row id (only set when the hit comes from the `place` table).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
    /// OSM node/way id (only set for Tantivy hits).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub osm_id: Option<i64>,
    pub name: String,
    /// OSM place kind (Tantivy hits only).
    #[serde(skip_serializing_if = "Option::is_none", rename = "placeKind")]
    pub place_kind: Option<String>,
    /// `place.type` (DB hits only — present on SQL LIKE fallback).
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ward: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub district: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    pub province: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    /// Tantivy relevance score (0..1). Only set for Tantivy hits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f32>,
    /// Distance from the `lat` / `lon` query param, in km. Set when
    /// the caller passes `lat` + `lon` (geo-bias).
    #[serde(skip_serializing_if = "Option::is_none", rename = "distanceKm")]
    pub distance_km: Option<f64>,
}

/// Response of `GET /api/places`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlaceListResponse {
    pub items: Vec<PlaceOut>,
}

/// Response of `GET /api/places/search?q=`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlaceSearchResponse {
    pub items: Vec<PlaceSearchHit>,
    /// Which engine produced the results: `tantivy` (fulltext index) or
    /// `sql` (LIKE fallback). Omitted for the SQL fallback.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
}

/// Response of `GET /api/places/reverse?lat=&lon=`. A list of the nearest
/// places to the query point, sorted by distance ascending.
pub type PlaceReverseResponse = Vec<PlaceSearchHit>;
