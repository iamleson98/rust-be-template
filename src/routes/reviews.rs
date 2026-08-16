use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use utoipa::IntoParams;
use uuid::Uuid;

use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::service::review_service::{CreateReviewInput, ReviewListFilter, UpdateReviewInput};
use crate::state::AppState;

#[derive(Deserialize, IntoParams)]
pub struct ListQuery {
    pub brand_id: Option<String>, pub route_id: Option<String>,
    pub user_id: Option<String>, pub status: Option<String>,
    pub limit: Option<u64>, pub offset: Option<u64>,
}

/// `GET /api/reviews` — list reviews with optional filters.
#[utoipa::path(
    get,
    path = "/api/reviews",
    tag = "reviews",
    params(ListQuery),
    responses(
        (status = 200, description = "Review list", body = Value),
    )
)]
pub async fn list(State(st): State<AppState>, Query(q): Query<ListQuery>) -> Result<Json<Value>, AppError> {
    let filter = ReviewListFilter { brand_id: q.brand_id, route_id: q.route_id, user_id: q.user_id, status: q.status, limit: q.limit.unwrap_or(20), offset: q.offset.unwrap_or(0) };
    Ok(Json(st.reviews.list(&filter).await?))
}

/// `GET /api/reviews/{id}` — get a review by ID.
#[utoipa::path(
    get,
    path = "/api/reviews/{id}",
    tag = "reviews",
    params(("id" = Uuid, Path, description = "Review ID")),
    responses(
        (status = 200, description = "Review detail", body = Value),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get(State(st): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.reviews.get(id).await?))
}

/// `POST /api/reviews` — create a review. Requires authentication.
#[utoipa::path(
    post,
    path = "/api/reviews",
    tag = "reviews",
    request_body = CreateReviewInput,
    responses(
        (status = 201, description = "Created review", body = Value),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn create(State(st): State<AppState>, AuthUser(uid): AuthUser, Json(body): Json<CreateReviewInput>) -> Result<Json<Value>, AppError> {
    let mut input = body;
    input.user_id = Some(uid.to_string());
    Ok(Json(st.reviews.create(&input).await?))
}

/// `PATCH /api/reviews/{id}` — update a review. Requires authentication.
#[utoipa::path(
    patch,
    path = "/api/reviews/{id}",
    tag = "reviews",
    params(("id" = Uuid, Path, description = "Review ID")),
    request_body = UpdateReviewInput,
    responses(
        (status = 200, description = "Updated review", body = Value),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn update(State(st): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>, Json(body): Json<UpdateReviewInput>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.reviews.update(id, Some(&uid.to_string()), &body).await?))
}

/// `DELETE /api/reviews/{id}` — delete a review. Requires authentication.
#[utoipa::path(
    delete,
    path = "/api/reviews/{id}",
    tag = "reviews",
    params(("id" = Uuid, Path, description = "Review ID")),
    responses(
        (status = 200, description = "Deleted", body = Value),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn remove(State(st): State<AppState>, AuthUser(uid): AuthUser, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    st.reviews.remove(id, Some(&uid.to_string())).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// `GET /api/reviews/tags` — get the review tags index.
#[utoipa::path(
    get,
    path = "/api/reviews/tags",
    tag = "reviews",
    responses(
        (status = 200, description = "Tags index", body = Value),
    )
)]
pub async fn tags(State(st): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(st.reviews.tags_index().await?))
}
