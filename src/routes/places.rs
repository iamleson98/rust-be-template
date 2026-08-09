use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListQuery { pub limit: Option<u64>, pub offset: Option<u64> }
pub async fn list(State(st): State<AppState>, Query(q): Query<ListQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.places.list(q.limit.unwrap_or(50), q.offset.unwrap_or(0)).await?))
}

#[derive(Deserialize)]
pub struct SearchQuery { pub q: String, pub limit: Option<u64>, pub lat: Option<f64>, pub lon: Option<f64> }
pub async fn search(State(st): State<AppState>, Query(q): Query<SearchQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.places.search(&q.q, q.limit.unwrap_or(10), q.lat, q.lon).await?))
}

#[derive(Deserialize)]
pub struct ReverseQuery { pub lat: f64, pub lon: f64, pub limit: Option<u64> }
pub async fn reverse(State(st): State<AppState>, Query(q): Query<ReverseQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.places.reverse(q.lat, q.lon, q.limit.unwrap_or(10)).await?))
}
