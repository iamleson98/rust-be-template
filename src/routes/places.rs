use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::dto::place::{PlaceListResponse, PlaceReverseResponse, PlaceSearchResponse};
use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
pub struct ListQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/places` — list places.
#[utoipa::path(
    get,
    path = "/api/places",
    tag = "places",
    params(ListQuery),
    responses(
        (status = 200, description = "Place list", body = PlaceListResponse),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Json<PlaceListResponse>, AppError> {
    Ok(Json(
        st.places
            .list(q.limit.unwrap_or(50), q.offset.unwrap_or(0))
            .await?,
    ))
}

#[derive(Deserialize, IntoParams)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<u64>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// `GET /api/places/search` — search places by query.
#[utoipa::path(
    get,
    path = "/api/places/search",
    tag = "places",
    params(SearchQuery),
    responses(
        (status = 200, description = "Search results", body = PlaceSearchResponse),
    )
)]
pub async fn search(
    State(st): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<PlaceSearchResponse>, AppError> {
    Ok(Json(
        st.places
            .search(&q.q, q.limit.unwrap_or(10), q.lat, q.lon)
            .await?,
    ))
}

#[derive(Deserialize, IntoParams)]
pub struct ReverseQuery {
    pub lat: f64,
    pub lon: f64,
    pub limit: Option<u64>,
}

/// `GET /api/places/reverse` — reverse geocode coordinates.
#[utoipa::path(
    get,
    path = "/api/places/reverse",
    tag = "places",
    params(ReverseQuery),
    responses(
        (status = 200, description = "Reverse geocode results", body = [crate::dto::place::PlaceSearchHit]),
    )
)]
pub async fn reverse(
    State(st): State<AppState>,
    Query(q): Query<ReverseQuery>,
) -> Result<Json<PlaceReverseResponse>, AppError> {
    Ok(Json(
        st.places
            .reverse(q.lat, q.lon, q.limit.unwrap_or(10))
            .await?,
    ))
}
