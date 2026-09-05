//! Admin — Vehicle type routes (`/api/admin/vehicle-types`).
//!
//! CRUD for the vehicle-class catalog (limousine, sleeper, 11-seater,
//! …). The schedule creation form's "Loại xe" picker reads this list;
//! the public trip search resolves a schedule's type through it (with
//! the bus-layout fallback for legacy rows).

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminMutationResponse, AdminVehicleTypeListResponse, AdminVehicleTypesQuery,
    UpsertVehicleTypeRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/vehicle-types?q=&limit=&offset=` — list the catalog
/// (label/code filter + offset pagination for the infinite picker).
#[utoipa::path(
    get,
    path = "/api/admin/vehicle-types",
    tag = "admin",
    params(AdminVehicleTypesQuery),
    responses(
        (status = 200, description = "Vehicle type list (items + total)", body = AdminVehicleTypeListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminVehicleTypesQuery>,
) -> Result<Json<AdminVehicleTypeListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_VEHICLE_TYPES_READ)
        .await?;
    Ok(Json(
        st.admin
            .list_vehicle_types(
                q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                q.limit,
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `POST /api/admin/vehicle-types` — create a vehicle type.
#[utoipa::path(
    post,
    path = "/api/admin/vehicle-types",
    tag = "admin",
    request_body = UpsertVehicleTypeRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 400, description = "Bad request — code/label missing"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 409, description = "Conflict — code already exists"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertVehicleTypeRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_VEHICLE_TYPES_WRITE)
        .await?;
    Ok(Json(st.admin.create_vehicle_type(&body).await?))
}

/// `PUT /api/admin/vehicle-types/{id}` — update (patch semantics).
#[utoipa::path(
    put,
    path = "/api/admin/vehicle-types/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Vehicle type id")),
    request_body = UpsertVehicleTypeRequest,
    responses(
        (status = 200, description = "Updated", body = AdminMutationResponse),
        (status = 400, description = "Bad request — invalid code/label/status"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Vehicle type not found"),
        (status = 409, description = "Conflict — code already exists"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertVehicleTypeRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_VEHICLE_TYPES_WRITE)
        .await?;
    Ok(Json(st.admin.update_vehicle_type(id, &body).await?))
}

/// `DELETE /api/admin/vehicle-types/{id}` — delete. Schedules
/// referencing the type fall back to their bus layout
/// (`ON DELETE SET NULL` semantics).
#[utoipa::path(
    delete,
    path = "/api/admin/vehicle-types/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Vehicle type id")),
    responses(
        (status = 200, description = "Deleted", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Vehicle type not found"),
    )
)]
pub async fn delete(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_VEHICLE_TYPES_WRITE)
        .await?;
    st.admin.delete_vehicle_type(id).await?;
    Ok(Json(AdminMutationResponse { id }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
