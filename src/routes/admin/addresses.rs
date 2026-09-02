//! Admin — Address routes (`/api/admin/addresses`).
//!
//! Brand-owned geographic points used by the schedule point picker.
//! The list endpoint requires `brandId` (addresses are brand-scoped).

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminAddressListResponse, AdminAddressesQuery, AdminMutationResponse, UpsertAddressRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/addresses?brandId=&q=&limit=&offset=` — list a
/// brand's addresses. `q`/`limit`/`offset` feed the searchable,
/// infinite-scroll schedule point picker; omitting `limit` returns all.
#[utoipa::path(
    get,
    path = "/api/admin/addresses",
    tag = "admin",
    params(AdminAddressesQuery),
    responses(
        (status = 200, description = "Address list (items + total)", body = AdminAddressListResponse),
        (status = 400, description = "Bad request — brandId is required"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminAddressesQuery>,
) -> Result<Json<AdminAddressListResponse>, AppError> {
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_ADDRESSES_READ)
        .await?;
    let brand_id = q
        .brand_id
        .ok_or_else(|| AppError::BadRequest("brandId is required".into()))?;
    Ok(Json(
        st.admin
            .list_addresses(
                &brand_id.to_string(),
                q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                q.limit,
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `POST /api/admin/addresses` — create an address.
#[utoipa::path(
    post,
    path = "/api/admin/addresses",
    tag = "admin",
    request_body = UpsertAddressRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 400, description = "Bad request — missing name/lat/lon/brandId"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Brand not found"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertAddressRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_ADDRESSES_WRITE)
        .await?;
    Ok(Json(st.admin.create_address(&body).await?))
}

/// `PUT /api/admin/addresses/{id}` — update an address.
#[utoipa::path(
    put,
    path = "/api/admin/addresses/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Address ID")),
    request_body = UpsertAddressRequest,
    responses(
        (status = 200, description = "Updated", body = AdminMutationResponse),
        (status = 400, description = "Bad request"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertAddressRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_ADDRESSES_WRITE)
        .await?;
    Ok(Json(st.admin.update_address(id, &body).await?))
}

/// `DELETE /api/admin/addresses/{id}` — delete an address.
#[utoipa::path(
    delete,
    path = "/api/admin/addresses/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Address ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Conflict — address is used by schedules"),
    )
)]
pub async fn delete(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    st.rbac
        .check(admin.user_id(), rbac::ADMIN_ADDRESSES_WRITE)
        .await?;
    st.admin.delete_address(id).await?;
    Ok(())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
