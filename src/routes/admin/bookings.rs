//! Admin — Booking management routes (`/api/admin/bookings`).

use axum::extract::{Path, Query, State};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminBookingDetailResponse, AdminBookingExportResponse, AdminBookingListResponse,
    AdminBookingStatsResponse, AdminBookingsQuery, UpdateBookingStatusRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

/// `GET /api/admin/bookings` — list bookings with admin filters.
#[utoipa::path(
    get,
    path = "/api/admin/bookings",
    tag = "admin",
    params(AdminBookingsQuery),
    responses(
        (status = 200, description = "Booking list", body = AdminBookingListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminBookingsQuery>,
) -> Result<Json<AdminBookingListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BOOKINGS_READ)
        .await?;
    Ok(Json(st.admin.list_bookings(&q).await?))
}

/// `GET /api/admin/bookings/{id}` — admin booking detail.
#[utoipa::path(
    get,
    path = "/api/admin/bookings/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Booking ID")),
    responses(
        (status = 200, description = "Booking detail", body = AdminBookingDetailResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminBookingDetailResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BOOKINGS_READ)
        .await?;
    Ok(Json(st.admin.get_booking(id).await?))
}

/// `PATCH /api/admin/bookings/{id}` — confirm (after phoning the customer),
/// complete or cancel a ticket. Completed and cancelled tickets are final.
#[utoipa::path(
    patch,
    path = "/api/admin/bookings/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Booking ID")),
    request_body = UpdateBookingStatusRequest,
    responses(
        (status = 200, description = "Status updated", body = AdminBookingDetailResponse),
        (status = 409, description = "The ticket is final or changed meanwhile"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update_status(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateBookingStatusRequest>,
) -> Result<Json<AdminBookingDetailResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BOOKINGS_WRITE)
        .await?;
    Ok(Json(
        st.admin
            .update_booking_status(admin.user_id(), id, &body)
            .await?,
    ))
}

/// `GET /api/admin/bookings/stats` — aggregate booking stats.
#[utoipa::path(
    get,
    path = "/api/admin/bookings/stats",
    tag = "admin",
    params(AdminBookingsQuery),
    responses(
        (status = 200, description = "Booking stats", body = AdminBookingStatsResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn stats(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminBookingsQuery>,
) -> Result<Json<AdminBookingStatsResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_STATS_READ)
        .await?;
    Ok(Json(st.admin.booking_stats(&q).await?))
}

/// `GET /api/admin/bookings/export` — CSV export.
#[utoipa::path(
    get,
    path = "/api/admin/bookings/export",
    tag = "admin",
    params(AdminBookingsQuery),
    responses(
        (status = 200, description = "CSV export", body = AdminBookingExportResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn export(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminBookingsQuery>,
) -> Result<Json<AdminBookingExportResponse>, AppError> {
    st.rbac.require(admin.user_id(), rbac::ADMIN_EXPORT).await?;
    Ok(Json(st.admin.booking_export(&q).await?))
}

pub fn router() -> Router<AppState> {
    // `get` is both a routing function and a handler in this module.
    // Import the routing function under a different name to avoid the
    // `get(get)` collision.
    use axum::routing::get as rget;
    Router::new()
        .route("/", rget(list))
        .route("/stats", rget(stats))
        .route("/export", rget(export))
        .route("/{id}", rget(get).patch(update_status))
}
