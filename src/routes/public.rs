use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::dto::public::{
    BrandDetailOut, BrandListResponse, CampaignListResponse, CampaignValidateResponse,
    RouteListResponse, SearchTripsQuery, StatsResponse, TripDetail, TripSearchResponse,
};
use crate::dto::route_media::RoutePictureListResponse;
use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct LimitQuery {
    pub limit: Option<u64>,
}

/// `GET /api/brands` — list brands.
#[utoipa::path(
    get,
    path = "/api/brands",
    tag = "public",
    params(LimitQuery),
    responses(
        (status = 200, description = "Brand list", body = BrandListResponse),
    )
)]
pub async fn brands(
    State(st): State<AppState>,
    Query(q): Query<LimitQuery>,
) -> Result<Json<BrandListResponse>, AppError> {
    Ok(Json(
        st.public
            .list_brands(q.limit.unwrap_or(20).min(200))
            .await?,
    ))
}

/// `GET /api/brands/{slug}` — get brand detail.
#[utoipa::path(
    get,
    path = "/api/brands/{slug}",
    tag = "public",
    params(("slug" = String, Path, description = "Brand slug")),
    responses(
        (status = 200, description = "Brand detail", body = BrandDetailOut),
        (status = 404, description = "Not found"),
    )
)]
pub async fn brand_detail(
    State(st): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Json<BrandDetailOut>, AppError> {
    Ok(Json(st.public.brand_detail(&slug).await?))
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct RoutesQuery {
    pub brand_id: Option<String>,
    pub limit: Option<u64>,
}

/// `GET /api/routes` — list routes.
#[utoipa::path(
    get,
    path = "/api/routes",
    tag = "public",
    params(RoutesQuery),
    responses(
        (status = 200, description = "Route list", body = RouteListResponse),
    )
)]
pub async fn routes(
    State(st): State<AppState>,
    Query(q): Query<RoutesQuery>,
) -> Result<Json<RouteListResponse>, AppError> {
    Ok(Json(
        st.public
            .list_routes(q.brand_id.as_deref(), q.limit.unwrap_or(50))
            .await?,
    ))
}

/// `GET /api/routes/{id}/pictures` — a route's picture gallery
/// (ordered; `sortOrder` 0 is the cover). Public read: URLs are
/// absolute against the CDN origin when configured, backend-proxied
/// otherwise. Returns an empty list for unknown routes (a route with
/// no pictures and a route that doesn't exist are the same to a
/// gallery renderer).
#[utoipa::path(
    get,
    path = "/api/routes/{id}/pictures",
    tag = "public",
    params(("id" = Uuid, Path, description = "Route ID")),
    responses(
        (status = 200, description = "Ordered gallery", body = RoutePictureListResponse),
    )
)]
pub async fn route_pictures(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<RoutePictureListResponse>, AppError> {
    Ok(Json(st.media.list(id).await?))
}

/// `GET /api/trips/{id}` — get trip detail.
#[utoipa::path(
    get,
    path = "/api/trips/{id}",
    tag = "public",
    params(("id" = Uuid, Path, description = "Trip ID")),
    responses(
        (status = 200, description = "Trip detail", body = TripDetail),
        (status = 404, description = "Not found"),
    )
)]
pub async fn trip_detail(
    State(st): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<TripDetail>, AppError> {
    Ok(Json(st.public.trip_detail(id).await?))
}

/// `GET /api/search` — search trips.
#[utoipa::path(
    get,
    path = "/api/search",
    tag = "public",
    params(SearchTripsQuery),
    responses(
        (status = 200, description = "Search results", body = TripSearchResponse),
    )
)]
pub async fn search_trips(
    State(st): State<AppState>,
    Query(q): Query<SearchTripsQuery>,
) -> Result<Json<TripSearchResponse>, AppError> {
    let vehicle_types: Vec<String> = q
        .vehicle_types
        .as_deref()
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(
        st.public
            .search_trips(
                &q.from,
                &q.to,
                &q.date,
                q.limit.unwrap_or(20).min(200),
                vehicle_types,
                q.sort.as_deref().unwrap_or("departure"),
                q.min_seats.unwrap_or(0),
            )
            .await?,
    ))
}

/// `GET /api/recommendations` — get trip recommendations.
#[utoipa::path(
    get,
    path = "/api/recommendations",
    tag = "public",
    responses(
        (status = 200, description = "Recommendations", body = TripSearchResponse),
    )
)]
pub async fn recommendations(
    State(st): State<AppState>,
) -> Result<Json<TripSearchResponse>, AppError> {
    Ok(Json(st.public.recommendations().await?))
}

/// `GET /api/campaigns` — list campaigns.
#[utoipa::path(
    get,
    path = "/api/campaigns",
    tag = "public",
    responses(
        (status = 200, description = "Campaign list", body = CampaignListResponse),
    )
)]
pub async fn campaigns(State(st): State<AppState>) -> Result<Json<CampaignListResponse>, AppError> {
    Ok(Json(st.public.list_campaigns().await?))
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct CampaignValidateQuery {
    pub code: String,
    pub subtotal: i64,
}

/// `GET /api/campaigns/validate` — validate a campaign code.
#[utoipa::path(
    get,
    path = "/api/campaigns/validate",
    tag = "public",
    params(CampaignValidateQuery),
    responses(
        (status = 200, description = "Validation result", body = CampaignValidateResponse),
        (status = 400, description = "Invalid campaign"),
    )
)]
pub async fn validate_campaign(
    State(st): State<AppState>,
    Query(q): Query<CampaignValidateQuery>,
) -> Result<Json<CampaignValidateResponse>, AppError> {
    Ok(Json(
        st.public.validate_campaign(&q.code, q.subtotal).await?,
    ))
}

/// `GET /api/stats` — get public stats.
#[utoipa::path(
    get,
    path = "/api/stats",
    tag = "public",
    responses(
        (status = 200, description = "Public stats", body = StatsResponse),
    )
)]
pub async fn stats(State(st): State<AppState>) -> Result<Json<StatsResponse>, AppError> {
    Ok(Json(st.public.stats().await?))
}

// ────────────────────────────────────────────────────────────────
//  Per-domain routers — exposed for `build_router` composition.
//  The public catalog has multiple sub-paths so each gets its own
//  small router function. Keeps `build_router` flat + readable.
// ────────────────────────────────────────────────────────────────

/// `/api/brands` + `/api/brands/{slug}`.
pub fn brands_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(brands))
        .route("/{slug}", get(brand_detail))
}

/// `/api/routes` (public list of bus routes — distinct from the admin
/// route CRUD at `/api/admin/routes`).
pub fn routes_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(routes))
        .route("/{id}/pictures", get(route_pictures))
}

/// `/api/trips/{id}`.
pub fn trips_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new().route("/{id}", get(trip_detail))
}

/// `/api/search` + `/api/search/geo`.
pub fn search_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(search_trips))
        .route("/geo", get(search_trips_geo))
}

/// `GET /api/search/geo` — geospatial trip search.
///
/// Finds routes where pickup points are closest to the user's desired
/// pickup coordinates AND drop points are closest to the desired drop
/// coordinates. Results are sorted by combined distance (closest first).
///
/// Uses bounding-box SQL + Rust haversine — works on SQLite without
/// PostGIS or SQLite math functions.
#[derive(Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct GeoSearchQuery {
    pub from_lat: f64,
    pub from_lon: f64,
    pub to_lat: f64,
    pub to_lon: f64,
    pub date: String,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub min_seats: Option<i64>,
    pub vehicle_types: Option<String>,
    pub max_distance_km: Option<f64>,
}

#[utoipa::path(
    get,
    path = "/api/search/geo",
    tag = "public",
    params(GeoSearchQuery),
    responses(
        (status = 200, description = "Geo search results", body = TripSearchResponse),
    )
)]
pub async fn search_trips_geo(
    State(st): State<AppState>,
    Query(q): Query<GeoSearchQuery>,
) -> Result<Json<TripSearchResponse>, AppError> {
    let vehicle_types: Vec<String> = q
        .vehicle_types
        .as_deref()
        .map(|s| {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        })
        .unwrap_or_default();
    Ok(Json(
        st.public
            .search_trips_geo(
                q.from_lat,
                q.from_lon,
                q.to_lat,
                q.to_lon,
                &q.date,
                q.limit.unwrap_or(20).min(100),
                q.offset.unwrap_or(0),
                q.min_seats.unwrap_or(0),
                vehicle_types,
                q.max_distance_km.unwrap_or(50.0),
            )
            .await?,
    ))
}

/// `/api/recommendations`.
pub fn recommendations_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new().route("/", get(recommendations))
}

/// `/api/campaigns` + `/api/campaigns/validate`.
pub fn campaigns_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(campaigns))
        .route("/validate", get(validate_campaign))
}

/// `/api/stats`.
pub fn stats_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new().route("/", get(stats))
}
