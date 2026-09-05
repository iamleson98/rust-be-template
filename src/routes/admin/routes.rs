//! Admin — Route (bus route) routes (`/api/admin/routes`).

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminMutationResponse, AdminRouteListResponse, AdminRoutesQuery, UpsertRouteRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/routes` — list routes (admin), with optional brand
/// filter, search and offset pagination.
#[utoipa::path(
    get,
    path = "/api/admin/routes",
    tag = "admin",
    params(AdminRoutesQuery),
    responses(
        (status = 200, description = "Route list", body = AdminRouteListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminRoutesQuery>,
) -> Result<Json<AdminRouteListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_READ)
        .await?;
    Ok(Json(
        st.admin
            .list_routes(
                q.brand_id.map(|id| id.to_string()).as_deref(),
                q.q.as_deref(),
                q.limit,
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `POST /api/admin/routes` — create a route.
#[utoipa::path(
    post,
    path = "/api/admin/routes",
    tag = "admin",
    request_body = UpsertRouteRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertRouteRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;
    Ok(Json(st.admin.create_route(&body).await?))
}

/// `PUT /api/admin/routes/{id}` — update a route.
#[utoipa::path(
    put,
    path = "/api/admin/routes/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Route ID")),
    request_body = UpsertRouteRequest,
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
    Json(body): Json<UpsertRouteRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;
    Ok(Json(st.admin.update_route(id, &body).await?))
}

/// `DELETE /api/admin/routes/{id}` — delete a route.
#[utoipa::path(
    delete,
    path = "/api/admin/routes/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Route ID")),
    responses(
        (status = 200, description = "Deleted", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn delete(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_ROUTES_WRITE)
        .await?;
    Ok(Json(st.admin.delete_route(id).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
