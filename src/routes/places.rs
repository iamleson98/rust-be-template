//! Place endpoints over the in-memory place index.
//!
//! Cache lifetimes: a search answer is good for 5 minutes, the popular list
//! and reverse geocoding for an hour, and anything answered while no index
//! exists yet (`engine: "unavailable"`) for a minute only. The handlers set
//! `Cache-Control` themselves, for anonymous and signed-in callers alike.

use axum::extract::{Query, State};
use axum::http::header::CACHE_CONTROL;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::dto::place::{PlaceEngine, PlaceListResponse, PlaceSearchResponse};
use crate::error::AppError;
use crate::state::AppState;

const SEARCH_MAX_AGE_SECS: u64 = 300;
const STATIC_MAX_AGE_SECS: u64 = 3600;
const UNAVAILABLE_MAX_AGE_SECS: u64 = 60;

const DEFAULT_LIMIT: u64 = 10;
const MAX_LIMIT: u64 = 50;
const DEFAULT_LIST_LIMIT: u64 = 50;
const MAX_LIST_LIMIT: u64 = 200;

fn cache_control(engine: PlaceEngine, max_age: u64) -> [(axum::http::HeaderName, String); 1] {
    let max_age = match engine {
        PlaceEngine::Index => max_age,
        PlaceEngine::Unavailable => max_age.min(UNAVAILABLE_MAX_AGE_SECS),
    };
    [(CACHE_CONTROL, format!("public, max-age={max_age}"))]
}

fn clamp(limit: Option<u64>, default: u64, max: u64) -> usize {
    limit.unwrap_or(default).clamp(1, max) as usize
}

/// A point that is on the globe.
fn point(lat: f64, lon: f64) -> Result<(f64, f64), AppError> {
    if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) {
        Ok((lat, lon))
    } else {
        Err(AppError::BadRequest(
            "lat must be within -90..90 and lon within -180..180".into(),
        ))
    }
}

#[derive(Deserialize, IntoParams)]
pub struct ListQuery {
    /// Default 50, 1..200.
    pub limit: Option<u64>,
    /// Places to skip from the top of the list.
    pub offset: Option<u64>,
}

/// `GET /api/places` — the most populous cities and towns.
#[utoipa::path(
    get,
    path = "/api/places",
    tag = "places",
    params(ListQuery),
    responses(
        (status = 200, description = "Popular places (empty until the first place index is built)", body = PlaceListResponse),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    Query(q): Query<ListQuery>,
) -> Result<Response, AppError> {
    let offset = q.offset.unwrap_or(0).min(usize::MAX as u64) as usize;
    let answer = st
        .places
        .popular(offset, clamp(q.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))
        .await?;
    Ok((
        cache_control(answer.engine, STATIC_MAX_AGE_SECS),
        Json(PlaceListResponse {
            items: answer.items,
        }),
    )
        .into_response())
}

#[derive(Deserialize, IntoParams)]
pub struct SearchQuery {
    /// The text to look for; blank lists the popular places.
    pub q: String,
    /// Default 10, 1..50.
    pub limit: Option<u64>,
    /// Favour places near this point; `lat` and `lon` go together.
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

/// `GET /api/places/search` — place autocomplete.
#[utoipa::path(
    get,
    path = "/api/places/search",
    tag = "places",
    params(SearchQuery),
    responses(
        (status = 200, description = "Search results; `engine` is `unavailable` (no items) until the first place index is built", body = PlaceSearchResponse),
        (status = 400, description = "`lat` without `lon` (or the reverse), or a point outside the globe"),
    )
)]
pub async fn search(
    State(st): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Response, AppError> {
    let near = match (q.lat, q.lon) {
        (None, None) => None,
        (Some(lat), Some(lon)) => Some(point(lat, lon)?),
        _ => return Err(AppError::BadRequest("lat and lon go together".into())),
    };
    let answer = st
        .places
        .search(&q.q, clamp(q.limit, DEFAULT_LIMIT, MAX_LIMIT), near)
        .await?;
    Ok((
        cache_control(answer.engine, SEARCH_MAX_AGE_SECS),
        Json(answer),
    )
        .into_response())
}

#[derive(Deserialize, IntoParams)]
pub struct ReverseQuery {
    pub lat: f64,
    pub lon: f64,
    /// Default 10, 1..50.
    pub limit: Option<u64>,
}

/// `GET /api/places/reverse` — the places nearest to a point, nearest first.
#[utoipa::path(
    get,
    path = "/api/places/reverse",
    tag = "places",
    params(ReverseQuery),
    responses(
        (status = 200, description = "Nearest places first (empty until the first place index is built)", body = [crate::dto::place::PlaceSearchHit]),
        (status = 400, description = "A point outside the globe"),
    )
)]
pub async fn reverse(
    State(st): State<AppState>,
    Query(q): Query<ReverseQuery>,
) -> Result<Response, AppError> {
    let (lat, lon) = point(q.lat, q.lon)?;
    let answer = st
        .places
        .reverse(lat, lon, clamp(q.limit, DEFAULT_LIMIT, MAX_LIMIT))
        .await?;
    Ok((
        cache_control(answer.engine, STATIC_MAX_AGE_SECS),
        Json(answer.items),
    )
        .into_response())
}

/// Build the places router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::get;
    axum::Router::new()
        .route("/", get(list))
        .route("/search", get(search))
        .route("/reverse", get(reverse))
}
