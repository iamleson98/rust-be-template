//! Payment routes — `/api/payments/*` (user-facing) and
//! `/api/payments/ipn/{provider}` (gateway callbacks) and
//! `/api/admin/payments/*` (admin).
//!
//! ## Auth model
//!
//! - User-facing routes (`POST /api/payments`, `GET /api/payments/{id}`,
//!   `GET /api/payments/booking/{bookingId}`, `POST /api/payments/{id}/cancel`)
//!   use `MaybeAuthUser` — guests who booked without logging in can still
//!   pay (they look up their booking by code on the bookings page).
//! - Admin routes (`GET /api/admin/payments`, `PATCH /api/admin/payments/{id}`,
//!   `POST /api/payments/{id}/mark-cod-collected`) use `AdminUser` + RBAC.
//! - IPN webhook routes (`POST /api/payments/ipn/{provider}`) use NO auth —
//!   they verify the provider signature instead. (The provider is the
//!   "authenticated principal" via HMAC.)

use std::collections::BTreeMap;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use uuid::Uuid;
use validator::Validate;

use crate::dto::payment::{
    AdminPaymentListResponse, AdminPaymentsQuery, CancelPaymentReq, CancelPaymentResponse,
    CreatePaymentReq, CreatePaymentResponse, ListPaymentsResponse, MarkCodCollectedReq,
    MarkCodCollectedResponse, PaymentOut, UpdatePaymentStatusReq, UpdatePaymentStatusResponse,
};
use crate::error::AppError;
use crate::middleware::{AdminUser, MaybeAuthUser};
use crate::payment::momo::MomoIpnPayload;
use crate::payment::zalopay::ZalopayCallbackPayload;
use crate::rbac::model::consts as rbac;
use crate::state::AppState;

// ────────────────────────────────────────────────────────────────
//  User-facing routes
// ────────────────────────────────────────────────────────────────

/// `POST /api/payments` — initiate a payment for a booking.
#[utoipa::path(
    post,
    path = "/api/payments",
    tag = "payments",
    request_body = CreatePaymentReq,
    responses(
        (status = 201, description = "Payment created", body = CreatePaymentResponse),
        (status = 400, description = "Invalid request"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not your booking"),
        (status = 404, description = "Booking not found"),
        (status = 409, description = "Booking not in pending status"),
        (status = 503, description = "Provider not configured"),
    )
)]
pub async fn create_payment(
    State(st): State<AppState>,
    maybe: MaybeAuthUser,
    Json(body): Json<CreatePaymentReq>,
) -> Result<Json<CreatePaymentResponse>, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let user_id = maybe.0.map(|u| u.to_string());
    Ok(Json(
        st.payments
            .create_payment(&body, user_id.as_deref())
            .await?,
    ))
}

/// `GET /api/payments/{id}` — get payment status (for polling).
#[utoipa::path(
    get,
    path = "/api/payments/{id}",
    tag = "payments",
    params(("id" = Uuid, Path, description = "Payment ID")),
    responses(
        (status = 200, description = "Payment detail", body = PaymentOut),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not your payment"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn get_payment(
    State(st): State<AppState>,
    maybe: MaybeAuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PaymentOut>, AppError> {
    let user_id = maybe.0.map(|u| u.to_string());
    Ok(Json(st.payments.get(id, user_id.as_deref()).await?))
}

/// `GET /api/payments/booking/{bookingId}` — list payments for a booking.
#[utoipa::path(
    get,
    path = "/api/payments/booking/{bookingId}",
    tag = "payments",
    params(("bookingId" = Uuid, Path, description = "Booking ID")),
    responses(
        (status = 200, description = "Payment list", body = ListPaymentsResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not your booking"),
        (status = 404, description = "Booking not found"),
    )
)]
pub async fn list_booking_payments(
    State(st): State<AppState>,
    maybe: MaybeAuthUser,
    Path(booking_id): Path<Uuid>,
) -> Result<Json<ListPaymentsResponse>, AppError> {
    let user_id = maybe.0.map(|u| u.to_string());
    Ok(Json(
        st.payments
            .list_by_booking(booking_id, user_id.as_deref())
            .await?,
    ))
}

/// `POST /api/payments/{id}/cancel` — cancel a pending payment.
#[utoipa::path(
    post,
    path = "/api/payments/{id}/cancel",
    tag = "payments",
    params(("id" = Uuid, Path, description = "Payment ID")),
    request_body = CancelPaymentReq,
    responses(
        (status = 200, description = "Payment cancelled", body = CancelPaymentResponse),
        (status = 400, description = "Payment is not in pending status"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — not your payment"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn cancel_payment(
    State(st): State<AppState>,
    maybe: MaybeAuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<CancelPaymentReq>,
) -> Result<Json<CancelPaymentResponse>, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    let user_id = maybe.0.map(|u| u.to_string());
    Ok(Json(
        st.payments
            .cancel(id, user_id.as_deref(), body.reason.as_deref())
            .await?,
    ))
}

/// `POST /api/payments/{id}/mark-cod-collected` — driver / admin marks
/// that cash was physically received for a COD booking.
#[utoipa::path(
    post,
    path = "/api/payments/{id}/mark-cod-collected",
    tag = "payments",
    params(("id" = Uuid, Path, description = "Payment ID")),
    request_body = MarkCodCollectedReq,
    responses(
        (status = 200, description = "COD payment marked collected", body = MarkCodCollectedResponse),
        (status = 400, description = "Not a COD payment or not pending"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden — admin role required"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn mark_cod_collected(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<MarkCodCollectedReq>,
) -> Result<Json<MarkCodCollectedResponse>, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_PAYMENTS_WRITE)
        .await?;
    Ok(Json(
        st.payments
            .mark_cod_collected(id, admin.user_id(), body.amount_collected, body.note)
            .await?,
    ))
}

// ────────────────────────────────────────────────────────────────
//  IPN webhook routes (NO auth — verified via HMAC signature)
// ────────────────────────────────────────────────────────────────

/// Query-param deserializer for VNPay's GET-style IPN callback.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct VnpayIpnParams {
    #[serde(flatten)]
    #[into_params(rename_all = "vnp_")]
    #[allow(dead_code)]
    pub params: BTreeMap<String, String>,
}

/// `GET /api/payments/ipn/vnpay` — VNPay IPN webhook.
///
/// VNPay POSTs the IPN as a GET request (with all params in the URL).
/// We re-verify the HMAC-SHA512 signature and transition the payment state.
/// Response body must be JSON `{"RspCode":"00","Message":"Confirm Success"}`.
#[utoipa::path(
    get,
    path = "/api/payments/ipn/vnpay",
    tag = "payments",
    params(VnpayIpnParams),
    responses(
        (status = 200, description = "IPN processed", body = crate::dto::payment::IpnResponse),
        (status = 400, description = "Missing or invalid params"),
        (status = 401, description = "Invalid signature"),
        (status = 404, description = "Payment not found"),
    )
)]
pub async fn vnpay_ipn(
    State(st): State<AppState>,
    Query(params): Query<BTreeMap<String, String>>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Parse and verify.
    match st.payments.handle_vnpay_ipn(&params).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "RspCode": "00",
            "Message": "Confirm Success"
        }))),
        Err(AppError::NotFound(msg)) => {
            // Still respond 200 + RspCode=01 so VNPay stops retrying.
            tracing::warn!(error = %msg, "VNPay IPN: payment not found");
            Ok(Json(serde_json::json!({
                "RspCode": "01",
                "Message": "Order Not Found"
            })))
        }
        Err(e) => {
            // For signature errors etc., respond with RspCode=97 so VNPay
            // retries (configurable per merchant).
            tracing::warn!(error = %e, "VNPay IPN verification failed");
            Ok(Json(serde_json::json!({
                "RspCode": "97",
                "Message": "Invalid Signature"
            })))
        }
    }
}

/// `POST /api/payments/ipn/momo` — MoMo IPN webhook.
///
/// MoMo POSTs JSON to `ipnUrl`. We verify the HMAC-SHA256 signature
/// over the canonical alphabetical-key string. Response: HTTP 204
/// with body `{"code":0,"message":"..."}`.
#[utoipa::path(
    post,
    path = "/api/payments/ipn/momo",
    tag = "payments",
    request_body = serde_json::Value,
    responses(
        (status = 200, description = "IPN processed", body = crate::dto::payment::IpnResponse),
        (status = 400, description = "Invalid body"),
        (status = 401, description = "Invalid signature"),
        (status = 404, description = "Payment not found"),
    )
)]
pub async fn momo_ipn(
    State(st): State<AppState>,
    Json(payload): Json<MomoIpnPayload>,
) -> Result<Json<serde_json::Value>, AppError> {
    match st.payments.handle_momo_ipn(&payload).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "code": 0,
            "message": "Success"
        }))),
        Err(AppError::NotFound(msg)) => {
            tracing::warn!(error = %msg, "MoMo IPN: payment not found");
            Ok(Json(serde_json::json!({
                "code": 1,
                "message": "Order Not Found"
            })))
        }
        Err(e) => {
            tracing::warn!(error = %e, "MoMo IPN verification failed");
            Ok(Json(serde_json::json!({
                "code": 2,
                "message": "Invalid Signature"
            })))
        }
    }
}

/// `POST /api/payments/ipn/zalopay` — ZaloPay callback webhook.
///
/// ZaloPay POSTs JSON; the `mac` field is HMAC-SHA256 over the raw body
/// bytes. We must read the body as raw bytes BEFORE deserialising to
/// avoid the JSON normaliser reformatting it (any byte-level difference
/// breaks the MAC).
///
/// The route handler:
///   1. Reads the raw body bytes.
///   2. Re-deserialises them to `ZalopayCallbackPayload`.
///   3. Passes both the parsed struct + raw bytes to the service.
#[utoipa::path(
    post,
    path = "/api/payments/ipn/zalopay",
    tag = "payments",
    request_body = serde_json::Value,
    responses(
        (status = 200, description = "Callback processed", body = crate::dto::payment::IpnResponse),
        (status = 400, description = "Invalid body"),
        (status = 401, description = "Invalid mac"),
        (status = 404, description = "Payment not found"),
    )
)]
pub async fn zalopay_callback(
    State(st): State<AppState>,
    raw_body: Bytes,
) -> Result<Json<serde_json::Value>, AppError> {
    let payload: ZalopayCallbackPayload = serde_json::from_slice(&raw_body)
        .map_err(|e| AppError::BadRequest(format!("ZaloPay callback body parse failed: {e}")))?;

    match st
        .payments
        .handle_zalopay_callback(&payload, &raw_body)
        .await
    {
        Ok(()) => Ok(Json(serde_json::json!({
            "return_code": 1,
            "return_message": "Success"
        }))),
        Err(AppError::NotFound(msg)) => {
            tracing::warn!(error = %msg, "ZaloPay callback: payment not found");
            // return_code 0 = "merchant did not process" → ZaloPay will retry.
            // Use return_code 2 to signal "already processed" so it stops.
            Ok(Json(serde_json::json!({
                "return_code": 2,
                "return_message": "Order Not Found"
            })))
        }
        Err(e) => {
            tracing::warn!(error = %e, "ZaloPay callback verification failed");
            Ok(Json(serde_json::json!({
                "return_code": 3,
                "return_message": "Invalid MAC"
            })))
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  Admin routes
// ────────────────────────────────────────────────────────────────

/// `GET /api/admin/payments` — paginated payment list.
#[utoipa::path(
    get,
    path = "/api/admin/payments",
    tag = "admin",
    params(AdminPaymentsQuery),
    responses(
        (status = 200, description = "Payment list", body = AdminPaymentListResponse),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
    )
)]
pub async fn list_admin_payments(
    State(st): State<AppState>,
    admin: AdminUser,
    Query(q): Query<AdminPaymentsQuery>,
) -> Result<Json<AdminPaymentListResponse>, AppError> {
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_PAYMENTS_READ)
        .await?;
    let limit = q.limit.unwrap_or(20).min(200);
    let offset = q.offset.unwrap_or(0);
    Ok(Json(
        st.payments
            .list_admin(q.status.as_deref(), q.provider.as_deref(), limit, offset)
            .await?,
    ))
}

/// `PATCH /api/admin/payments/{id}` — admin override of payment status.
///
/// Used to manually mark a payment as `completed` (when the IPN failed
/// but the admin confirmed via the provider's dashboard) or `refunded`
/// (when a refund was issued out-of-band).
#[utoipa::path(
    patch,
    path = "/api/admin/payments/{id}",
    tag = "admin",
    params(("id" = Uuid, Path, description = "Payment ID")),
    request_body = UpdatePaymentStatusReq,
    responses(
        (status = 200, description = "Payment status updated", body = UpdatePaymentStatusResponse),
        (status = 400, description = "Invalid status"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Forbidden"),
        (status = 404, description = "Not found"),
    )
)]
pub async fn update_payment_status(
    State(st): State<AppState>,
    admin: AdminUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdatePaymentStatusReq>,
) -> Result<Json<UpdatePaymentStatusResponse>, AppError> {
    body.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;
    body.validate_status()?;
    st.rbac
        .require(admin.user_id(), rbac::ADMIN_PAYMENTS_WRITE)
        .await?;
    Ok(Json(
        st.payments
            .update_status(id, &body.status, body.reason.as_deref())
            .await?,
    ))
}

/// Build the user-facing payments router (`/api/payments/*`).
///
/// Includes the IPN webhook routes — they're mounted under `/payments/ipn/*`
/// and use NO auth (verified via HMAC signature instead).
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, post};
    axum::Router::new()
        .route("/", post(create_payment))
        .route("/booking/{bookingId}", get(list_booking_payments))
        .route("/{id}", get(get_payment))
        .route("/{id}/cancel", post(cancel_payment))
        .route("/{id}/mark-cod-collected", post(mark_cod_collected))
        // IPN webhooks (no auth — verified via HMAC signature).
        .route("/ipn/vnpay", get(vnpay_ipn))
        .route("/ipn/momo", post(momo_ipn))
        .route("/ipn/zalopay", post(zalopay_callback))
}

/// Build the admin payments router (`/api/admin/payments/*`).
///
/// Mounted under `/admin/payments` by `build_router`. RBAC-guarded
/// (AdminUser extractor + permission check inside each handler).
pub fn admin_router() -> axum::Router<crate::state::AppState> {
    use axum::routing::{get, patch};
    axum::Router::new()
        .route("/", get(list_admin_payments))
        .route("/{id}", patch(update_payment_status))
}
