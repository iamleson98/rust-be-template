use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;
use validator::Validate;

use crate::dto::booking::{
    BookingCancelResponse, BookingConfirmResponse, BookingHoldResponse, BookingListResponse,
    BookingOut, CancelReq, HoldReq,
};
use crate::error::AppError;
use crate::middleware::AuthUser;
use crate::state::AppState;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct ListQuery {
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// `GET /api/bookings` — the authenticated customer's tickets, newest first.
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
    let limit = q.limit.unwrap_or(50);
    Ok(Json(
        st.bookings.list(uid, limit, q.offset.unwrap_or(0)).await?,
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
    AuthUser(uid): AuthUser,
    Json(body): Json<HoldReq>,
) -> Result<Json<BookingHoldResponse>, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    // Bind the booking to the authenticated caller so subsequent cancel/
    // confirm calls can verify ownership (BOLA defense).
    Ok(Json(st.bookings.hold_with_user(uid, &body).await?))
}

/// `GET /api/bookings/{id}` — one of the customer's bookings, by UUID or
/// by its code.
#[utoipa::path(
    get,
    path = "/api/bookings/{id}",
    tag = "bookings",
    params(("id" = String, Path, description = "Booking ID (UUID) or booking code")),
    responses(
        (status = 200, description = "Booking detail", body = BookingOut),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn detail(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<BookingOut>, AppError> {
    Ok(Json(st.bookings.detail(uid, &id).await?))
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
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CancelReq>,
) -> Result<Json<BookingCancelResponse>, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    Ok(Json(
        st.bookings.cancel(uid, id, body.reason.as_deref()).await?,
    ))
}

/// `POST /api/bookings/{id}/place` — pay on board: the booking is placed
/// and its seats held until departure while the operator phones the
/// customer to confirm it. Online payments go through `/api/payments`.
#[utoipa::path(
    post,
    path = "/api/bookings/{id}/place",
    tag = "bookings",
    params(("id" = Uuid, Path, description = "Booking ID")),
    responses(
        (status = 200, description = "Booking placed, awaiting the operator", body = BookingConfirmResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 410, description = "The seat hold ran out"),
    )
)]
pub async fn place(
    State(st): State<AppState>,
    AuthUser(uid): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<BookingConfirmResponse>, AppError> {
    Ok(Json(st.bookings.place_cash(uid, id).await?))
}

/// Build the bookings router.
///
/// Mounts both `/` (list + hold) and `/{id}` (detail + cancel +
/// confirm). The `/hold` alias is kept for backward compatibility with
/// older frontend code that POSTs to `/api/bookings/hold` directly.
///
/// NOTE: the old `GET /lookup` (find a booking by phone/code without
/// authenticating) was removed — `hold` requires an authenticated
/// caller, so every booking belongs to an account and "check ticket by
/// phone number" had nothing to find. Users see their bookings on the
/// account console instead.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", get(list).post(hold))
        .route("/hold", post(hold))
        .route("/{id}", get(detail))
        .route("/{id}/cancel", post(cancel))
        .route("/{id}/place", post(place))
}
