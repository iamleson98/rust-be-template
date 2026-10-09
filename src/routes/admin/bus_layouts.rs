//! Admin — Bus Layout routes (`/api/admin/bus-layouts`).
//!
//! The seat-map catalog. Create generates the concrete `seat` rows from
//! a seat plan (or a rectangular grid spec) — the trip materializer only
//! sells layouts that HAVE seats; update is a metadata patch; the plan
//! endpoints read and replace the floor plan while keeping the seat ids
//! trips point at (once trips sell a layout its seats can only be moved,
//! relabelled or re-classed); delete is guarded — schedules referencing
//! the layout, or seats with materialized inventory / sold tickets, block
//! the delete with a descriptive 409 instead of a raw FK error.

use axum::extract::{Path, Query, State};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminBusLayoutListResponse, AdminBusLayoutsQuery, AdminMutationResponse, UpsertBusLayoutRequest,
};
use crate::dto::seat_plan::{
    AdminBusLayoutDetail, BusLayoutPresetListResponse, FitSeatPlanRequest, SeatPlan,
    UpsertSeatPlanRequest,
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

/// `GET /api/admin/bus-layouts/presets` — ready-made seat plans for
/// common vehicles (limousine, sleeper, 29/45-seat coach, …).
#[utoipa::path(
    get,
    path = "/api/admin/bus-layouts/presets",
    tag = "admin",
    responses(
        (status = 200, description = "Layout templates", body = BusLayoutPresetListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn presets(
    State(st): State<AppState>,
    admin: AdminUser,
) -> Result<Json<BusLayoutPresetListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_READ)
        .await?;
    Ok(Json(st.admin.bus_layout_presets()))
}

/// `GET /api/admin/bus-layouts/{id}` — one layout with its seat plan.
/// Layouts that predate plans come back with a plain derived grid
/// (`planned = false`).
#[utoipa::path(
    get,
    path = "/api/admin/bus-layouts/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Bus layout ID")),
    responses(
        (status = 200, description = "Layout with plan", body = AdminBusLayoutDetail),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn detail(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminBusLayoutDetail>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_READ)
        .await?;
    Ok(Json(st.admin.get_bus_layout(id).await?))
}

/// `POST /api/admin/bus-layouts` — create a bus layout. A `plan` makes
/// the seat rows from the floor plan; else `seatGrid` (default 10×4×1 =
/// 40) generates a plain grid.
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

/// `PUT /api/admin/bus-layouts/{id}/plan` — replace the seat plan.
///
/// Seats are matched to cells by `seatId`, then by label, and keep their
/// identity. Once trips or tickets use the layout, cells may only be
/// moved, relabelled or re-classed: adding or removing seats is a 409.
#[utoipa::path(
    put,
    path = "/api/admin/bus-layouts/{id}/plan",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Bus layout ID")),
    request_body = UpsertSeatPlanRequest,
    responses(
        (status = 200, description = "Saved", body = AdminMutationResponse),
        (status = 400, description = "Invalid plan"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
        (status = 409, description = "Conflict — the layout is in use and the plan adds/removes seats"),
    )
)]
pub async fn replace_plan(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertSeatPlanRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_WRITE)
        .await?;
    Ok(Json(
        st.admin.replace_bus_layout_plan(id, &body.plan).await?,
    ))
}

/// `POST /api/admin/bus-layouts/{id}/plan/fit` — preview a catalog
/// template laid over this layout's existing seats (ids and labels
/// kept). Nothing is saved; send the result to `PUT …/plan` to apply it.
#[utoipa::path(
    post,
    path = "/api/admin/bus-layouts/{id}/plan/fit",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Bus layout ID")),
    request_body = FitSeatPlanRequest,
    responses(
        (status = 200, description = "The fitted plan", body = SeatPlan),
        (status = 400, description = "The template cannot hold exactly these seats"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Layout or template not found"),
    )
)]
pub async fn fit_plan(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<FitSeatPlanRequest>,
) -> Result<Json<SeatPlan>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BUS_LAYOUTS_READ)
        .await?;
    Ok(Json(
        st.admin.fit_bus_layout_plan(id, &body.preset_id).await?,
    ))
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
        .route("/presets", get(presets))
        .route("/{id}", get(detail).put(update).delete(delete))
        .route("/{id}/plan", put(replace_plan))
        .route("/{id}/plan/fit", post(fit_plan))
}
