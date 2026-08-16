//! DTOs for the routing service (`/api/routing/directions`, `/matrix`,
//! `/isochrone`). These are thin wrappers around the Valhalla routing
//! proxy responses — the service proxies to Valhalla and reshapes the
//! result into a compact, frontend-friendly form.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Turn-by-turn driving directions.
///
/// Returned by `GET /api/routing/directions`. The `valhalla` field
/// carries the raw Valhalla `trip` object (kept opaque — different
/// Valhalla versions emit slightly different shapes; we expose the
/// top-level summary fields the UI cares about).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DirectionsResponse {
    /// Raw Valhalla `trip` object (opaque — passed through as-is).
    pub valhalla: serde_json::Value,
    /// Encoded polyline of the route, if Valhalla returned one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    /// Total trip length in kilometers.
    pub distance_km: f64,
    /// Total trip time in minutes.
    pub time_min: f64,
}

/// Many-to-many travel time / distance matrix.
///
/// Returned by `GET /api/routing/matrix`. `timesMin[i][j]` is the
/// travel time (in minutes) from source `i` to target `j`;
/// `distancesKm[i][j]` is the distance in km. `None` cells mean
/// Valhalla could not route between that pair.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MatrixResponse {
    /// `times_min[i][j]` = minutes from source `i` to target `j`.
    pub times_min: Vec<Vec<Option<f64>>>,
    /// `distances_km[i][j]` = km from source `i` to target `j`.
    pub distances_km: Vec<Vec<Option<f64>>>,
}

/// Reachability polygons (isochrones).
///
/// Returned by `GET /api/routing/isochrone`. The `geojson` field is
/// the raw Valhalla isochrone response (a FeatureCollection of polygons
/// — one per contour time).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IsochroneResponse {
    /// Raw Valhalla isochrone GeoJSON FeatureCollection.
    pub geojson: serde_json::Value,
}

// ────────────────────────────────────────────────────────────────
//  Query params — re-exported so the route layer's `params(...)` and
//  the OpenAPI spec reference a single source of truth.
// ────────────────────────────────────────────────────────────────

/// Query params for `GET /api/routing/directions`.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct DirectionsQueryDto {
    /// Costing model: `auto`, `bicycle`, `pedestrian`, ...
    pub costing: Option<String>,
    /// Response language (`vi`, `en`, ...).
    pub language: Option<String>,
    /// Semicolon-separated `lat,lon` pairs: `lat,lon;lat,lon;...`.
    pub locations: String,
}

/// Query params for `GET /api/routing/matrix`.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct MatrixQueryDto {
    pub costing: Option<String>,
    /// Semicolon-separated `lat,lon` pairs for sources.
    pub sources: String,
    /// Semicolon-separated `lat,lon` pairs for targets.
    pub targets: String,
}

/// Query params for `GET /api/routing/isochrone`.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct IsochroneQueryDto {
    pub costing: Option<String>,
    pub lat: f64,
    pub lon: f64,
    /// Comma-separated contour minutes: `15,30,60`.
    pub contours: Option<String>,
}
