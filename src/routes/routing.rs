use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;

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

#[derive(Deserialize)]
pub struct DirectionsQuery { pub costing: Option<String>, pub language: Option<String>, pub locations: String }
pub async fn directions(State(st): State<AppState>, Query(q): Query<DirectionsQuery>) -> Result<Json<Value>, AppError> {
    let locs = parse_locs(&q.locations)?;
    Ok(Json(st.routing.directions(q.costing.as_deref().unwrap_or("auto"), q.language.as_deref().unwrap_or("vi"), &locs).await?))
}

#[derive(Deserialize)]
pub struct MatrixQuery { pub costing: Option<String>, pub sources: String, pub targets: String }
pub async fn matrix(State(st): State<AppState>, Query(q): Query<MatrixQuery>) -> Result<Json<Value>, AppError> {
    let srcs = parse_locs(&q.sources)?;
    let tgts = parse_locs(&q.targets)?;
    Ok(Json(st.routing.matrix(q.costing.as_deref().unwrap_or("auto"), &srcs, &tgts).await?))
}

#[derive(Deserialize)]
pub struct IsochroneQuery { pub costing: Option<String>, pub lat: f64, pub lon: f64, pub contours: Option<String> }
pub async fn isochrone(State(st): State<AppState>, Query(q): Query<IsochroneQuery>) -> Result<Json<Value>, AppError> {
    let contours: Vec<u32> = q.contours.as_deref().map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect()).unwrap_or_else(|| vec![15, 30, 60]);
    Ok(Json(st.routing.isochrone(q.costing.as_deref().unwrap_or("auto"), (q.lat, q.lon), &contours).await?))
}
