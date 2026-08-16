//! Admin routes — all under `/api/admin/*`. Every handler requires
//! the `AdminUser` extractor (authenticated + employee role check).
//!
//! Routes:
//!   Brands:        GET/POST /api/admin/brands, GET/PUT/DELETE /api/admin/brands/{id}
//!   Routes:        GET/POST /api/admin/routes, GET/PUT/DELETE /api/admin/routes/{id}
//!   Schedules:     GET/POST /api/admin/schedules, PUT/DELETE /api/admin/schedules/{id}
//!   PickupPoints:  GET/POST /api/admin/pickup-points, PUT/DELETE /api/admin/pickup-points/{id}
//!   BusLayouts:    GET /api/admin/bus-layouts
//!   Reviews:       GET /api/admin/reviews, PATCH /api/admin/reviews/{id}, DELETE /api/admin/reviews/{id}
//!   Bookings:      GET /api/admin/bookings, GET /api/admin/bookings/{id}, PATCH /api/admin/bookings/{id}
//!                  GET /api/admin/bookings/stats, GET /api/admin/bookings/export

use axum::extract::{Path, Query, State};
use axum::Json;
use uuid::Uuid;

use crate::dto::admin::{
    AdminBookingsQuery, AdminBookingDetailResponse, AdminBookingExportResponse,
    AdminBookingListResponse, AdminBookingStatsResponse, AdminBrandListResponse,
    AdminBusLayoutListResponse, AdminMutationResponse, AdminPickupPointListResponse,
    AdminPickupPointsQuery, AdminReviewListResponse, AdminRouteListResponse, AdminRoutesQuery,
    AdminScheduleListResponse, AdminSchedulesQuery, AdminBusLayoutsQuery, AdminReviewsQuery,
    ModerateReviewRequest, ModerateReviewResponse, UpdateBookingStatusRequest,
    UpdateBookingStatusResponse, UpsertBrandRequest, UpsertPickupPointRequest,
    UpsertRouteRequest, UpsertScheduleRequest,
};
use crate::error::AppError;
use crate::middleware::AdminUser;
use crate::state::AppState;

// ────────────────────────────────────────────────────────────────
//  Brands
// ────────────────────────────────────────────────────────────────

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
pub async fn list_brands(
    State(st): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<AdminBrandListResponse>, AppError> {
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
pub async fn create_brand(
    State(st): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<UpsertBrandRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn update_brand(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertBrandRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn delete_brand(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    Ok(Json(st.admin.delete_brand(id).await?))
}

// ────────────────────────────────────────────────────────────────
//  Routes
// ────────────────────────────────────────────────────────────────

/// `GET /api/admin/routes` — list all routes (admin).
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
pub async fn list_routes(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(_q): Query<AdminRoutesQuery>,
) -> Result<Json<AdminRouteListResponse>, AppError> {
    // The store's list_all_routes doesn't support brand_id filter yet;
    // we return all and let the caller filter client-side. For full
    // server-side filtering, the store trait would need extension.
    Ok(Json(st.admin.list_routes().await?))
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
pub async fn create_route(
    State(st): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<UpsertRouteRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn update_route(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertRouteRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn delete_route(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminMutationResponse>, AppError> {
    Ok(Json(st.admin.delete_route(id).await?))
}

// ────────────────────────────────────────────────────────────────
//  Schedules
// ────────────────────────────────────────────────────────────────

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
pub async fn list_schedules(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminSchedulesQuery>,
) -> Result<Json<AdminScheduleListResponse>, AppError> {
    let route_id = q
        .route_id
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
pub async fn create_schedule(
    State(st): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<UpsertScheduleRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn update_schedule(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertScheduleRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn delete_schedule(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    st.admin.delete_schedule(id).await?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
//  Pickup Points
// ────────────────────────────────────────────────────────────────

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
pub async fn list_pickup_points(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminPickupPointsQuery>,
) -> Result<Json<AdminPickupPointListResponse>, AppError> {
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
pub async fn create_pickup_point(
    State(st): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<UpsertPickupPointRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn update_pickup_point(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertPickupPointRequest>,
) -> Result<Json<AdminMutationResponse>, AppError> {
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
pub async fn delete_pickup_point(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    st.admin.delete_pickup_point(id).await?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
//  Bus Layouts
// ────────────────────────────────────────────────────────────────

/// `GET /api/admin/bus-layouts` — list all bus layouts.
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
pub async fn list_bus_layouts(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(_q): Query<AdminBusLayoutsQuery>,
) -> Result<Json<AdminBusLayoutListResponse>, AppError> {
    // The store doesn't support brand_id filter yet; return all.
    Ok(Json(st.admin.list_bus_layouts().await?))
}

// ────────────────────────────────────────────────────────────────
//  Reviews moderation
// ────────────────────────────────────────────────────────────────

/// `GET /api/admin/reviews` — list reviews with admin filters.
#[utoipa::path(
    get,
    path = "/api/admin/reviews",
    tag = "admin",
    params(AdminReviewsQuery),
    responses(
        (status = 200, description = "Review list", body = AdminReviewListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_reviews(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminReviewsQuery>,
) -> Result<Json<AdminReviewListResponse>, AppError> {
    Ok(Json(
        st.admin
            .list_reviews(
                q.status.as_deref(),
                q.brand_id.as_deref(),
                q.route_id.as_deref(),
                q.limit.unwrap_or(50),
                q.offset.unwrap_or(0),
            )
            .await?,
    ))
}

/// `PATCH /api/admin/reviews/{id}` — moderate a review (status + reply).
#[utoipa::path(
    patch,
    path = "/api/admin/reviews/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Review ID")),
    request_body = ModerateReviewRequest,
    responses(
        (status = 200, description = "Moderated", body = ModerateReviewResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn moderate_review(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ModerateReviewRequest>,
) -> Result<Json<ModerateReviewResponse>, AppError> {
    Ok(Json(st.admin.update_review_status(id, &body).await?))
}

/// `DELETE /api/admin/reviews/{id}` — delete a review (admin override).
#[utoipa::path(
    delete,
    path = "/api/admin/reviews/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Review ID")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn delete_review(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<(), AppError> {
    // Admin can delete any review — pass None for caller_user_id.
    st.reviews.remove(id, None).await?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────
//  Bookings management
// ────────────────────────────────────────────────────────────────

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
pub async fn list_bookings(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminBookingsQuery>,
) -> Result<Json<AdminBookingListResponse>, AppError> {
    Ok(Json(
        st.admin
            .list_bookings(
                q.status.as_deref(),
                q.brand_id.as_deref(),
                q.route_id.as_deref(),
                q.date_from.as_deref(),
                q.date_to.as_deref(),
                q.search.as_deref(),
                q.limit.unwrap_or(50),
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
pub async fn get_booking(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminBookingDetailResponse>, AppError> {
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
pub async fn update_booking_status(
    State(st): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateBookingStatusRequest>,
) -> Result<Json<UpdateBookingStatusResponse>, AppError> {
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
pub async fn booking_stats(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminBookingsQuery>,
) -> Result<Json<AdminBookingStatsResponse>, AppError> {
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
pub async fn booking_export(
    State(st): State<AppState>,
    _admin: AdminUser,
    Query(q): Query<AdminBookingsQuery>,
) -> Result<Json<AdminBookingExportResponse>, AppError> {
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
