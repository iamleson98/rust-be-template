//! Admin — Pickup Point routes (`/api/admin/pickup-points`).

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminMutationResponse, AdminPickupPointListResponse, AdminPickupPointsQuery,
    UpsertPickupPointRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/pickup-points?routeId=` — list pickup points for a route.
#[utoipa::path(
    get,
    path = "/api/admin/pickup-points",
    tag = "admin",
    params(AdminPickupPointsQuery),
    responses(
        (status = 200, description = "Pickup point list", body = AdminPickupPointListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminPickupPointsQuery>,
) -> Result<Json<AdminPickupPointListResponse>, AppError> {
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_PICKUP_POINTS_READ)
        .await?;
    let route_id = q
        .route_id
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?;
    Ok(Json(st.admin.list_pickup_points(route_id).await?))
}

/// `POST /api/admin/pickup-points` — create a pickup point.
#[utoipa::path(
    post,
    path = "/api/admin/pickup-points",
    tag = "admin",
    request_body = UpsertPickupPointRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertPickupPointRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_PICKUP_POINTS_WRITE)
        .await?;
    Ok(Json(st.admin.create_pickup_point(&body).await?))
}

/// `PUT /api/admin/pickup-points/{id}` — update a pickup point.
#[utoipa::path(
    put,
    path = "/api/admin/pickup-points/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Pickup point ID")),
    request_body = UpsertPickupPointRequest,
    responses(
        (status = 200, description = "Updated", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertPickupPointRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_PICKUP_POINTS_WRITE)
        .await?;
    Ok(Json(st.admin.update_pickup_point(id, &body).await?))
}

/// `DELETE /api/admin/pickup-points/{id}` — delete a pickup point.
#[utoipa::path(
    delete,
    path = "/api/admin/pickup-points/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Pickup point ID")),
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
        .check(admin.user_id(), rbac::ADMIN_PICKUP_POINTS_WRITE)
        .await?;
    st.admin.delete_pickup_point(id).await?;
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
