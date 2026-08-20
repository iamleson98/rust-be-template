//! Admin — Schedule routes (`/api/admin/schedules`).

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminMutationResponse, AdminScheduleListResponse, AdminSchedulesQuery, UpsertScheduleRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/schedules?routeId=` — list schedules for a route.
#[utoipa::path(
    get,
    path = "/api/admin/schedules",
    tag = "admin",
    params(AdminSchedulesQuery),
    responses(
        (status = 200, description = "Schedule list", body = AdminScheduleListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminSchedulesQuery>,
) -> Result<Json<AdminScheduleListResponse>, AppError> {
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_SCHEDULES_READ)
        .await?;
    let route_id_str = q.route_id.map(|u| u.to_string());
    let route_id = route_id_str
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?;
    Ok(Json(st.admin.list_schedules(route_id).await?))
}

/// `POST /api/admin/schedules` — create a schedule.
#[utoipa::path(
    post,
    path = "/api/admin/schedules",
    tag = "admin",
    request_body = UpsertScheduleRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertScheduleRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_SCHEDULES_WRITE)
        .await?;
    Ok(Json(st.admin.create_schedule(&body).await?))
}

/// `PUT /api/admin/schedules/{id}` — update a schedule.
#[utoipa::path(
    put,
    path = "/api/admin/schedules/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Schedule ID")),
    request_body = UpsertScheduleRequest,
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
    Json(body): Json<UpsertScheduleRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_SCHEDULES_WRITE)
        .await?;
    Ok(Json(st.admin.update_schedule(id, &body).await?))
}

/// `DELETE /api/admin/schedules/{id}` — delete a schedule.
#[utoipa::path(
    delete,
    path = "/api/admin/schedules/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Schedule ID")),
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
        .check(admin.user_id(), rbac::ADMIN_SCHEDULES_WRITE)
        .await?;
    st.admin.delete_schedule(id).await?;
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
