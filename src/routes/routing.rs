use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use utoipa::IntoParams;

use crate::error::AppError;
use crate::state::AppState;

fn parse_locs(s: &str) -> Result<Vec<(f64, f64)>, AppError> {
    s.split(';').filter(|x| !x.is_empty()).map(|p| {
        let mut it = p.split(',');
        let lat: f64 = it.next().ok_or_else(|| AppError::BadRequest("bad loc".into()))?.trim().parse().map_err(|_| AppError::BadRequest("bad lat".into()))?;
        let lon: f64 = it.next().ok_or_else(|| AppError::BadRequest("bad loc".into()))?.trim().parse().map_err(|_| AppError::BadRequest("bad lon".into()))?;
        Ok((lat, lon))
    }).collect()
}

#[derive(Deserialize, IntoParams)]
pub struct DirectionsQuery { pub costing: Option<String>, pub language: Option<String>, pub locations: String }

/// `GET /api/routing/directions` — get directions between locations.
#[utoipa::path(
    get,
    path = "/api/routing/directions",
    tag = "routing",
    params(DirectionsQuery),
    responses(
        (status = 200, description = "Directions", body = Value),
        (status = 400, description = "Bad request"),
    )
)]
pub async fn directions(State(st): State<AppState>, Query(q): Query<DirectionsQuery>) -> Result<Json<Value>, AppError> {
    let locs = parse_locs(&q.locations)?;
    Ok(Json(st.routing.directions(q.costing.as_deref().unwrap_or("auto"), q.language.as_deref().unwrap_or("vi"), &locs).await?))
}

#[derive(Deserialize, IntoParams)]
pub struct MatrixQuery { pub costing: Option<String>, pub sources: String, pub targets: String }

/// `GET /api/routing/matrix` — compute distance/time matrix.
#[utoipa::path(
    get,
    path = "/api/routing/matrix",
    tag = "routing",
    params(MatrixQuery),
    responses(
        (status = 200, description = "Matrix result", body = Value),
        (status = 400, description = "Bad request"),
    )
)]
pub async fn matrix(State(st): State<AppState>, Query(q): Query<MatrixQuery>) -> Result<Json<Value>, AppError> {
    let srcs = parse_locs(&q.sources)?;
    let tgts = parse_locs(&q.targets)?;
    Ok(Json(st.routing.matrix(q.costing.as_deref().unwrap_or("auto"), &srcs, &tgts).await?))
}

#[derive(Deserialize, IntoParams)]
pub struct IsochroneQuery { pub costing: Option<String>, pub lat: f64, pub lon: f64, pub contours: Option<String> }

/// `GET /api/routing/isochrone` — compute isochrone contours.
#[utoipa::path(
    get,
    path = "/api/routing/isochrone",
    tag = "routing",
    params(IsochroneQuery),
    responses(
        (status = 200, description = "Isochrone result", body = Value),
        (status = 400, description = "Bad request"),
    )
)]
pub async fn isochrone(State(st): State<AppState>, Query(q): Query<IsochroneQuery>) -> Result<Json<Value>, AppError> {
    let contours: Vec<u32> = q.contours.as_deref().map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect()).unwrap_or_else(|| vec![15, 30, 60]);
    Ok(Json(st.routing.isochrone(q.costing.as_deref().unwrap_or("auto"), (q.lat, q.lon), &contours).await?))
}
