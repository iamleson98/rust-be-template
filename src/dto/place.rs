//! DTOs of the place endpoints (`/api/places`, `/api/places/search`,
//! `/api/places/reverse`).
//!
//! The wire shape is camelCase and matches what the Worker's place routes
//! returned: `{ id, name, nameNoTones, type, province, district, ward, lat,
//! lon, score }` per hit.

use serde::Serialize;
use utoipa::ToSchema;

use crate::places::PlaceHit;

/// One place, as returned by search, the popular list and reverse geocoding.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaceSearchHit {
    /// OSM type letter + id: `n123` (node), `w45` (way), `r6` (relation).
    pub id: String,
    pub name: String,
    /// The name without tone marks, lower case (`ha noi`).
    pub name_no_tones: String,
    /// Kind of place: `city`, `town`, `bus_station`, `airport`, `street`, ...
    #[serde(rename = "type")]
    pub kind: String,
    pub province: Option<String>,
    pub district: Option<String>,
    pub ward: Option<String>,
    pub lat: f64,
    pub lon: f64,
    /// Relevance of a search hit; `0` for the popular list and reverse geocoding.
    pub score: f64,
}

impl From<PlaceHit> for PlaceSearchHit {
    fn from(hit: PlaceHit) -> Self {
        Self {
            id: hit.id,
            name: hit.name,
            name_no_tones: hit.name_no_tones,
            kind: hit.kind,
            province: hit.province,
            district: hit.district,
            ward: hit.ward,
            lat: hit.lat,
            lon: hit.lon,
            score: hit.score,
        }
    }
}

/// Which index answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PlaceEngine {
    /// The place index served the request.
    Index,
    /// No place index has been built yet: the items are empty.
    Unavailable,
}

/// Response of `GET /api/places/search`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaceSearchResponse {
    pub items: Vec<PlaceSearchHit>,
    pub engine: PlaceEngine,
}

/// Response of `GET /api/places`: the most populous cities and towns.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaceListResponse {
    pub items: Vec<PlaceSearchHit>,
}

/// Response of `GET /api/places/reverse`: the nearest places, nearest first.
pub type PlaceReverseResponse = Vec<PlaceSearchHit>;
