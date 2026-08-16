use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use utoipa::IntoParams;
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
pub struct LimitQuery { pub limit: Option<u64> }

/// `GET /api/brands` — list brands.
#[utoipa::path(
    get,
    path = "/api/brands",
    tag = "public",
    params(LimitQuery),
    responses(
        (status = 200, description = "Brand list", body = Value),
    )
)]
pub async fn brands(State(st): State<AppState>, Query(q): Query<LimitQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.list_brands(q.limit.unwrap_or(20)).await?))
}

/// `GET /api/brands/{slug}` — get brand detail.
#[utoipa::path(
    get,
    path = "/api/brands/{slug}",
    tag = "public",
    params(("slug" = String, Path, description = "Brand slug")),
    responses(
        (status = 200, description = "Brand detail", body = Value),
        (status = 404, description = "Not found"),
    )
)]
pub async fn brand_detail(State(st): State<AppState>, Path(slug): Path<String>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.brand_detail(&slug).await?))
}

#[derive(Deserialize, IntoParams)]
pub struct RoutesQuery { pub brand_id: Option<String>, pub limit: Option<u64> }

/// `GET /api/routes` — list routes.
#[utoipa::path(
    get,
    path = "/api/routes",
    tag = "public",
    params(RoutesQuery),
    responses(
        (status = 200, description = "Route list", body = Value),
    )
)]
pub async fn routes(State(st): State<AppState>, Query(q): Query<RoutesQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.list_routes(q.brand_id.as_deref(), q.limit.unwrap_or(50)).await?))
}

/// `GET /api/trips/{id}` — get trip detail.
#[utoipa::path(
    get,
    path = "/api/trips/{id}",
    tag = "public",
    params(("id" = Uuid, Path, description = "Trip ID")),
    responses(
        (status = 200, description = "Trip detail", body = Value),
        (status = 404, description = "Not found"),
    )
)]
pub async fn trip_detail(State(st): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.trip_detail(id).await?))
}

#[derive(Deserialize, IntoParams)]
pub struct SearchQuery {
    pub from: String, pub to: String, pub date: String,
    pub limit: Option<u64>, pub vehicle_types: Option<String>,
    pub sort: Option<String>, pub min_seats: Option<i64>,
}

/// `GET /api/search` — search trips.
#[utoipa::path(
    get,
    path = "/api/search",
    tag = "public",
    params(SearchQuery),
    responses(
        (status = 200, description = "Search results", body = Value),
    )
)]
pub async fn search_trips(State(st): State<AppState>, Query(q): Query<SearchQuery>) -> Result<Json<Value>, AppError> {
    let vehicle_types: Vec<String> = q.vehicle_types.as_deref().map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    Ok(Json(st.public.search_trips(&q.from, &q.to, &q.date, q.limit.unwrap_or(20), vehicle_types, q.sort.as_deref().unwrap_or("departure"), q.min_seats.unwrap_or(0)).await?))
}

/// `GET /api/recommendations` — get trip recommendations.
#[utoipa::path(
    get,
    path = "/api/recommendations",
    tag = "public",
    responses(
        (status = 200, description = "Recommendations", body = Value),
    )
)]
pub async fn recommendations(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.recommendations().await?))
}

/// `GET /api/campaigns` — list campaigns.
#[utoipa::path(
    get,
    path = "/api/campaigns",
    tag = "public",
    responses(
        (status = 200, description = "Campaign list", body = Value),
    )
)]
pub async fn campaigns(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.list_campaigns().await?))
}

#[derive(Deserialize, IntoParams)]
pub struct CampaignValidateQuery { pub code: String, pub subtotal: i64 }

/// `GET /api/campaigns/validate` — validate a campaign code.
#[utoipa::path(
    get,
    path = "/api/campaigns/validate",
    tag = "public",
    params(CampaignValidateQuery),
    responses(
        (status = 200, description = "Validation result", body = Value),
        (status = 400, description = "Invalid campaign"),
    )
)]
pub async fn validate_campaign(State(st): State<AppState>, Query(q): Query<CampaignValidateQuery>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.validate_campaign(&q.code, q.subtotal).await?))
}

/// `GET /api/stats` — get public stats.
#[utoipa::path(
    get,
    path = "/api/stats",
    tag = "public",
    responses(
        (status = 200, description = "Public stats", body = Value),
    )
)]
pub async fn stats(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.public.stats().await?))
}
