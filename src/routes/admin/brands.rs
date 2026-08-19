//! Admin — Brand routes (`/api/admin/brands`).
//!
//! Each handler requires the `AdminUser` extractor (authenticated + employee
//! role check) + an RBAC permission check at the route layer.

use axum::extract::{Path, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{AdminBrandListResponse, AdminMutationResponse, UpsertBrandRequest};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/brands` — list all brands (admin).
#[utoipa::path(
    get,
    path = "/api/admin/brands",
    tag = "admin",
    responses(
        (status = 200, description = "Brand list", body = AdminBrandListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — employee role required"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
) -> Result<Json<AdminBrandListResponse>, AppError> {
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_BRANDS_READ)
        .await?;
    Ok(Json(st.admin.list_brands().await?))
}

/// `POST /api/admin/brands` — create a brand.
#[utoipa::path(
    post,
    path = "/api/admin/brands",
    tag = "admin",
    request_body = UpsertBrandRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertBrandRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_BRANDS_WRITE)
        .await?;
    Ok(Json(st.admin.create_brand(&body).await?))
}

/// `PUT /api/admin/brands/{id}` — update a brand.
#[utoipa::path(
    put,
    path = "/api/admin/brands/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Brand ID")),
    request_body = UpsertBrandRequest,
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
    Json(body): Json<UpsertBrandRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_BRANDS_WRITE)
        .await?;
    Ok(Json(st.admin.update_brand(id, &body).await?))
}

/// `DELETE /api/admin/brands/{id}` — delete a brand.
#[utoipa::path(
    delete,
    path = "/api/admin/brands/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Brand ID")),
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
        .check(admin.user_id(), rbac::ADMIN_BRANDS_WRITE)
        .await?;
    Ok(Json(st.admin.delete_brand(id).await?))
}

/// Build the brand admin router.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
