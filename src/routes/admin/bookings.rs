//! Admin — Booking management routes (`/api/admin/bookings`).

use axum::extract::{Path, Query, State};
use axum::{Json, Router};
use uuid::Uuid;
use validator::Validate;

use crate::dto::admin::{
    AdminBookingDetailResponse, AdminBookingExportResponse, AdminBookingListResponse,
    AdminBookingStatsResponse, AdminBookingsQuery, UpdateBookingStatusRequest,
    UpdateBookingStatusResponse,
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
    Ok(Json(
        st.admin
            .list_bookings(
                q.status.as_deref(),
                q.brand_id.map(|u| u.to_string()).as_deref(),
                q.route_id.map(|u| u.to_string()).as_deref(),
                q.date_from.as_deref(),
                q.date_to.as_deref(),
                q.search.as_deref(),
                q.limit.unwrap_or(50).min(200),
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
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

/// `PATCH /api/admin/bookings/{id}` — update booking status (admin override).
#[utoipa::path(
    patch,
    path = "/api/admin/bookings/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Booking ID")),
    request_body = UpdateBookingStatusRequest,
    responses(
        (status = 200, description = "Status updated", body = UpdateBookingStatusResponse),
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
) -> Result<Json<UpdateBookingStatusResponse>, AppError> {
    body.validate().map_err(AppError::from)?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_BOOKINGS_WRITE)
        .await?;
    Ok(Json(st.admin.update_booking_status(id, &body).await?))
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
    Ok(Json(
        st.admin
            .booking_stats(
                q.status.as_deref(),
                q.date_from.as_deref(),
                q.date_to.as_deref(),
            )
            .await?,
    ))
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
    Ok(Json(
        st.admin
            .booking_export(
                q.status.as_deref(),
                q.date_from.as_deref(),
                q.date_to.as_deref(),
                // The frontend sends `columns` as a separate query param
                // (not in AdminBookingsQuery). We parse it manually from
                // the raw query string via `Query<AdminBookingsQuery>`'s
                // leftover — for now, pass None to use default columns.
                None,
            )
            .await?,
    ))
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
