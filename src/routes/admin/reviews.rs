//! Admin — Review moderation routes (`/api/admin/reviews`).

use axum::extract::{Path, Query, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminReviewBrandSummaryListResponse, AdminReviewListResponse, AdminReviewsQuery,
    ModerateReviewRequest, ModerateReviewResponse,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/reviews` — list reviews with admin filters.
#[utoipa::path(
    get,
    path = "/api/admin/reviews",
    tag = "admin",
    params(AdminReviewsQuery),
    responses(
        (status = 200, description = "Review list", body = AdminReviewListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminReviewsQuery>,
) -> Result<Json<AdminReviewListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_REVIEWS_MODERATE)
        .await?;
    Ok(Json(
        st.admin
            .list_reviews(
                q.status.as_deref(),
                q.brand_id.map(|u| u.to_string()).as_deref(),
                q.route_id.map(|u| u.to_string()).as_deref(),
                q.search.as_deref(),
                q.limit.unwrap_or(50).min(200),
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `GET /api/admin/reviews/summary` — per-brand feedback aggregates
/// (volume / status counts / avg rating) for the admin feedback page's
/// brand cards. Sorted by feedback volume descending.
#[utoipa::path(
    get,
    path = "/api/admin/reviews/summary",
    tag = "admin",
    responses(
        (status = 200, description = "Per-brand feedback summary", body = AdminReviewBrandSummaryListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn summary(
    State(st): State<AppState>,
    admin: AdminUser,
) -> Result<Json<AdminReviewBrandSummaryListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_REVIEWS_MODERATE)
        .await?;
    Ok(Json(st.reviews.brand_summary().await?))
}

/// `PATCH /api/admin/reviews/{id}` — moderate a review (status + reply).
#[utoipa::path(
    patch,
    path = "/api/admin/reviews/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Review ID")),
    request_body = ModerateReviewRequest,
    responses(
        (status = 200, description = "Moderated", body = ModerateReviewResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn moderate(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ModerateReviewRequest>,
) -> Result<Json<ModerateReviewResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_REVIEWS_MODERATE)
        .await?;
    Ok(Json(st.admin.update_review_status(id, &body).await?))
}

/// `DELETE /api/admin/reviews/{id}` — delete a review (admin override).
#[utoipa::path(
    delete,
    path = "/api/admin/reviews/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Review ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn delete(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_REVIEWS_MODERATE)
        .await?;
    // Admin can delete any review — pass None for caller_user_id.
    st.reviews.remove(id, None).await?;
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/summary", get(summary))
        .route("/", get(list))
        .route("/{id}", patch(moderate).delete(delete))
}
