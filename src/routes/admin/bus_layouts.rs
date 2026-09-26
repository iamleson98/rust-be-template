//! Admin — Bus Layout routes (`/api/admin/bus-layouts`).
//!
//! CRUD for the seat-map catalog. Create generates the concrete `seat`
//! rows from a rectangular grid spec (the trip materializer only
//! sells layouts that HAVE seats); update is a metadata patch (seat
//! grids can never be regenerated without orphaning sold-ticket
//! history); delete is guarded — schedules referencing the layout, or
//! seats with materialized inventory / sold tickets, block the delete
//! with a descriptive 409 instead of a raw FK error.

use axum::extract::{Path, Query, State};
use axum::routing::{get, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminBusLayoutListResponse, AdminBusLayoutsQuery, AdminMutationResponse, UpsertBusLayoutRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/bus-layouts` — list bus layouts, with optional brand
/// filter and offset pagination.
#[utoipa::path(
    get,
    path = "/api/admin/bus-layouts",
    tag = "admin",
    params(AdminBusLayoutsQuery),
    responses(
        (status = 200, description = "Bus layout list", body = AdminBusLayoutListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminBusLayoutsQuery>,
) -> Result<Json<AdminBusLayoutListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_READ)
        .await?;
    Ok(Json(
        st.admin
            .list_bus_layouts(
                q.brand_id.map(|id| id.to_string()).as_deref(),
                q.limit,
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `POST /api/admin/bus-layouts` — create a bus layout (with generated
/// seat rows when `seatGrid` is provided; defaults to 10×4×1 = 40).
#[utoipa::path(
    post,
    path = "/api/admin/bus-layouts",
    tag = "admin",
    request_body = UpsertBusLayoutRequest,
    responses(
        (status = 201, description = "Created", body = AdminMutationResponse),
        (status = 400, description = "Bad request — name missing"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 422, description = "Unprocessable — seat grid out of range"),
    )
)]
pub async fn create(
    State(st): State<AppState>,
    admin: AdminUser,
    Json(body): Json<UpsertBusLayoutRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_WRITE)
        .await?;
    Ok(Json(st.admin.create_bus_layout(&body).await?))
}

/// `PUT /api/admin/bus-layouts/{id}` — update a bus layout's metadata
/// (name / brand / vehicle type / total seats / layout data).
#[utoipa::path(
    put,
    path = "/api/admin/bus-layouts/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Bus layout ID")),
    request_body = UpsertBusLayoutRequest,
    responses(
        (status = 200, description = "Updated", body = AdminMutationResponse),
        (status = 400, description = "Bad request — empty name"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertBusLayoutRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_WRITE)
        .await?;
    Ok(Json(st.admin.update_bus_layout(id, &body).await?))
}

/// `DELETE /api/admin/bus-layouts/{id}` — delete a bus layout.
///
/// Blocked with `409 Conflict` while any schedule references the
/// layout, or any of its seats carry `seat_inventory` /
/// `booking_seat` rows (all FKs are `Restrict`).
#[utoipa::path(
    delete,
    path = "/api/admin/bus-layouts/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Bus layout ID")),
    responses(
        (status = 200, description = "Deleted", body = AdminMutationResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Conflict — schedules / trips / tickets reference the layout"),
    )
)]
pub async fn delete(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_WRITE)
        .await?;
    Ok(Json(st.admin.delete_bus_layout(id).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/{id}", put(update).delete(delete))
}
