use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;

use crate::dto::booking::{
    BookingCancelResponse, BookingConfirmResponse, BookingDetailResponse, BookingHoldResponse,
    BookingListItem, BookingListResponse, BookingLookupResponse, CancelReq, ConfirmReq, HoldReq,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct ListQuery {
    pub status: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/bookings` — list the authenticated user's bookings.
#[utoipa::path(
    get,
    path = "/api/bookings",
    tag = "bookings",
    params(ListQuery),
    responses(
        (status = 200, description = "Booking list", body = BookingListResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn list(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Query(q): Query<ListQuery>,
) -> Result<Json<BookingListResponse>, AppError> {
    let status = q.status.unwrap_or_else(|| "all".into());
    let limit = q.limit.unwrap_or(20);
    let offset = q.offset.unwrap_or(0);
    Ok(Json(
        st.bookings
            .list(&uid.to_string(), &status, limit, offset)
            .await?,
    ))
}

/// `POST /api/bookings` and `POST /api/bookings/hold` — hold seats for a booking.
#[utoipa::path(
    post,
    path = "/api/bookings",
    tag = "bookings",
    request_body = HoldReq,
    responses(
        (status = 201, description = "Booking held", body = BookingHoldResponse),
        (status = 401, description = "Unauthorized"),
    )
)]
pub async fn hold(
    State(st): State<AppState>,
    AuthUser(_uid): AuthUser,
    Json(body): Json<HoldReq>,
) -> Result<Json<BookingHoldResponse>, AppError> {
    Ok(Json(st.bookings.hold(&body).await?))
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct LookupQuery {
    pub phone: Option<String>,
    pub code: Option<String>,
}

/// `GET /api/bookings/lookup` — lookup a booking by phone or code.
#[utoipa::path(
    get,
    path = "/api/bookings/lookup",
    tag = "bookings",
    params(LookupQuery),
    responses(
        (status = 200, description = "Booking found", body = BookingLookupResponse),
        (status = 404, description = "Not found"),
    )
)]
pub async fn lookup(
    State(st): State<AppState>,
    Query(q): Query<LookupQuery>,
) -> Result<Json<BookingLookupResponse>, AppError> {
    Ok(Json(
        st.bookings
            .lookup(q.phone.as_deref(), q.code.as_deref())
            .await?,
    ))
}

/// `GET /api/bookings/{id}` — get booking detail.
#[utoipa::path(
    get,
    path = "/api/bookings/{id}",
    tag = "bookings",
    params(("id" = Uuid, Path, description = "Booking ID")),
    responses(
        (status = 200, description = "Booking detail", body = BookingListItem),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn detail(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<BookingDetailResponse>, AppError> {
    Ok(Json(st.bookings.detail(Some(&uid.to_string()), id).await?))
}

/// `POST /api/bookings/{id}/cancel` — cancel a booking.
#[utoipa::path(
    post,
    path = "/api/bookings/{id}/cancel",
    tag = "bookings",
    params(("id" = Uuid, Path, description = "Booking ID")),
    request_body = CancelReq,
    responses(
        (status = 200, description = "Booking cancelled", body = BookingCancelResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn cancel(
    State(st): State<AppState>,
    AuthUser(_uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CancelReq>,
) -> Result<Json<BookingCancelResponse>, AppError> {
    Ok(Json(st.bookings.cancel(id, body.reason.as_deref()).await?))
}

/// `POST /api/bookings/{id}/confirm` — confirm a booking with payment.
#[utoipa::path(
    post,
    path = "/api/bookings/{id}/confirm",
    tag = "bookings",
    params(("id" = Uuid, Path, description = "Booking ID")),
    request_body = ConfirmReq,
    responses(
        (status = 200, description = "Booking confirmed", body = BookingConfirmResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn confirm(
    State(st): State<AppState>,
    AuthUser(_uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<ConfirmReq>,
) -> Result<Json<BookingConfirmResponse>, AppError> {
    Ok(Json(st.bookings.confirm(id, &body.payment_method).await?))
}
