use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct LimitQuery { pub limit: Option<u64> }

pub async fn brands(State(st): State<AppState>, Query(q): Query<LimitQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.list_brands(q.limit.unwrap_or(20)).await?))
}

pub async fn brand_detail(State(st): State<AppState>, Path(slug): Path<String>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.brand_detail(&slug).await?))
}

#[derive(Deserialize)]
pub struct RoutesQuery { pub brand_id: Option<String>, pub limit: Option<u64> }
pub async fn routes(State(st): State<AppState>, Query(q): Query<RoutesQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.list_routes(q.brand_id.as_deref(), q.limit.unwrap_or(50)).await?))
}

pub async fn trip_detail(State(st): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.trip_detail(id).await?))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    pub from: String, pub to: String, pub date: String,
    pub limit: Option<u64>, pub vehicle_types: Option<String>,
    pub sort: Option<String>, pub min_seats: Option<i64>,
}
pub async fn search_trips(State(st): State<AppState>, Query(q): Query<SearchQuery>) -> Result<Json<Value>, AppError> {
    let vehicle_types: Vec<String> = q.vehicle_types.as_deref().map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    Ok(Json(st.public.search_trips(&q.from, &q.to, &q.date, q.limit.unwrap_or(20), vehicle_types, q.sort.as_deref().unwrap_or("departure"), q.min_seats.unwrap_or(0)).await?))
}

pub async fn recommendations(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.recommendations().await?))
}

pub async fn campaigns(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.list_campaigns().await?))
}

#[derive(Deserialize)]
pub struct CampaignValidateQuery { pub code: String, pub subtotal: i64 }
pub async fn validate_campaign(State(st): State<AppState>, Query(q): Query<CampaignValidateQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.validate_campaign(&q.code, q.subtotal).await?))
}

pub async fn stats(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.stats().await?))
}
