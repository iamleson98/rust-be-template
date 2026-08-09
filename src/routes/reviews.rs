use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::service::review_service::{CreateReviewInput, ReviewListFilter, UpdateReviewInput};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListQuery {
    pub brand_id: Option<String>, pub route_id: Option<String>,
    pub user_id: Option<String>, pub status: Option<String>,
    pub limit: Option<u64>, pub offset: Option<u64>,
}
pub async fn list(State(st): State<AppState>, Query(q): Query<ListQuery>) -> Result<Json<Value>, AppError> {
    let filter = ReviewListFilter { brand_id: q.brand_id, route_id: q.route_id, user_id: q.user_id, status: q.status, limit: q.limit.unwrap_or(20), offset: q.offset.unwrap_or(0) };
    Ok(Json(st.reviews.list(&filter).await?))
}

pub async fn get(State(st): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.reviews.get(id).await?))
}

pub async fn create(State(st): State<AppState>, AuthUser(uid): AuthUser, Json(body): Json<CreateReviewInput>) -> Result<Json<Value>, AppError> {
    let mut input = body;
    input.user_id = Some(uid.to_string());
    Ok(Json(st.reviews.create(&input).await?))
}

pub async fn update(State(st): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(body): Json<UpdateReviewInput>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.reviews.update(id, Some(&uid.to_string()), &body).await?))
}

pub async fn remove(State(st): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    st.reviews.remove(id, Some(&uid.to_string())).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn tags(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.reviews.tags_index().await?))
}
