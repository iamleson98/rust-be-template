//! DTOs for the payment service (`/api/payments/*`, `/api/admin/payments/*`,
//! `/api/payments/ipn/{provider}`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` so Rust field names
//! stay snake_case (Rust convention) while the JSON wire shape is
//! camelCase (JSON/TypeScript convention) — same convention as the rest
//! of the codebase.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::payment::model::{providers, statuses};
use crate::validation::validate_phone;

// ────────────────────────────────────────────────────────────────
//  Request DTOs
// ────────────────────────────────────────────────────────────────

/// Request body for `POST /api/payments` — initiate a payment for a booking.
///
/// The `provider` field selects which gateway to use:
/// - `vnpay`, `momo`, `zalopay` → user is redirected to the gateway's hosted
///   checkout page. The gateway then redirects back to the app + sends an
///   IPN webhook to confirm.
/// - `vietqr` → server generates an EMV QR string; user scans it with their
///   banking app to transfer funds. Confirmation is manual (admin
///   reconciliation) or via a future H2H bank webhook.
/// - `cod` → cash-on-boarding. No gateway interaction. Booking is held
///   until the driver/agent marks cash as collected.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaymentReq {
    /// Booking id to pay for. Must be in `pending` status (not yet confirmed).
    pub booking_id: Uuid,
    /// One of: `vnpay` | `momo` | `zalopay` | `vietqr` | `cod`.
    /// Validated against the entity's allow-list.
    #[validate(length(min = 1, max = 16))]
    pub provider: String,
}

impl CreatePaymentReq {
    /// Returns `Ok(())` if the provider string is one of the allowed values.
    pub fn validate_provider(&self) -> Result<(), AppError> {
        if providers::ALL.contains(&self.provider.as_str()) {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "invalid provider: {} (allowed: {})",
                self.provider,
                providers::ALL.join(", ")
            )))
        }
    }
}

// Re-export for use in routes/openapi
use crate::error::AppError;

/// Request body for `POST /api/payments/{id}/cancel`.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CancelPaymentReq {
    #[serde(default)]
    #[validate(length(max = 1000))]
    pub reason: Option<String>,
}

/// Request body for `POST /api/payments/{id}/mark-cod-collected`.
/// Driver / admin marks that cash was physically received for a COD booking.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct MarkCodCollectedReq {
    /// Optional: amount actually collected (VND integer). Defaults to the
    /// payment's recorded amount. Useful if the driver collected partial cash.
    #[serde(default)]
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub amount_collected: Option<i64>,
    /// Optional note (e.g. "passenger paid 50k cash + 20k transfer").
    #[serde(default)]
    #[validate(length(max = 500))]
    pub note: Option<String>,
}

/// Request body for `PATCH /api/admin/payments/{id}`.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePaymentStatusReq {
    /// One of: `pending` | `completed` | `failed` | `cancelled` | `refunded`.
    #[validate(length(min = 1, max = 16))]
    pub status: String,
    #[serde(default)]
    #[validate(length(max = 1000))]
    pub reason: Option<String>,
}

impl UpdatePaymentStatusReq {
    pub fn validate_status(&self) -> Result<(), AppError> {
        if statuses::ALL.contains(&self.status.as_str()) {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "invalid status: {} (allowed: {})",
                self.status,
                statuses::ALL.join(", ")
            )))
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  Response DTOs
// ────────────────────────────────────────────────────────────────

/// A single payment row, with provider-specific rendering hints.
///
/// Front-end rendering rules:
/// - `gatewayUrl` is set → render a "Pay now" button that opens the URL
///   in a new tab. Used by VNPay/MoMo/ZaloPay.
/// - `qrPayload` is set → render a QR image (encode the payload string with
///   any client-side QR library, or call the `qr-image` endpoint). Used by
///   VietQR.
/// - Neither is set + `provider == "cod"` → render "Pay on the bus" copy
///   + "Cash collected by driver" status pill. Used by COD.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PaymentOut {
    pub id: Uuid,
    pub booking_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Uuid>,
    pub provider: String,
    pub status: String,
    pub amount: i64,
    pub currency: String,
    pub created_at: String,
    pub updated_at: String,
    pub provider_txn_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_trans_id: Option<String>,
    /// For VNPay/MoMo/ZaloPay: hosted checkout URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway_url: Option<String>,
    /// For VietQR: the EMV QR TLV string (CRC included).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_payload: Option<String>,
    /// For VietQR: a PNG data URI of the QR image, pre-rendered server-side.
    /// Saves the front-end from pulling a QR library. `qr_payload` is also
    /// returned for clients that want to render their own QR.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_image_data_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    /// For COD: when the driver collected the cash.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_at: Option<String>,
    /// For COD: which admin user marked the payment as collected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_by: Option<String>,
    /// Bank details for the manual-transfer (VietQR) flow. Returned only
    /// when the provider is `vietqr` — used to display "Transfer to: …"
    /// instructions alongside the QR.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bank_transfer_instructions: Option<BankTransferInstructions>,
    /// Public URL where the gateway should redirect the user after the
    /// user completes / cancels the payment on the hosted checkout page.
    /// The front-end uses this to build its own "Return to app" button
    /// in case the auto-redirect fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_url: Option<String>,
}

/// Manual bank-transfer instructions for the VietQR flow.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BankTransferInstructions {
    pub bank_bin: String,
    pub bank_name: String,
    pub account_no: String,
    pub account_name: String,
    pub amount: i64,
    /// Memo to include in the transfer — embeds the booking code so the
    /// reconciliation script can match incoming transfers to bookings.
    pub memo: String,
}

/// Response of `POST /api/payments` and `GET /api/payments/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePaymentResponse {
    pub payment: PaymentOut,
}

/// Response of `GET /api/payments/booking/{bookingId}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListPaymentsResponse {
    pub items: Vec<PaymentOut>,
    /// Total matching-row count (independent of pagination). Omitted
    /// when the endpoint doesn't paginate (e.g. booking-detail lookup).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

/// Response of `POST /api/payments/{id}/cancel`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CancelPaymentResponse {
    pub payment_id: Uuid,
    pub status: String,
    pub cancelled_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Response of `POST /api/payments/{id}/mark-cod-collected`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkCodCollectedResponse {
    pub payment_id: Uuid,
    pub status: String,
    pub amount_collected: i64,
    pub collected_at: String,
}

// ────────────────────────────────────────────────────────────────
//  Admin response DTOs
// ────────────────────────────────────────────────────────────────

/// Admin-flavoured `PaymentOut` — same fields, plus a few admin-only
/// extras (booking code + provider response blob).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminPaymentOut {
    pub id: Uuid,
    pub booking_id: Uuid,
    /// Joined from the booking row — the human-readable booking code
    /// (e.g. `VEXEVN-AB12CD`). Lets the admin list / search without an
    /// extra round-trip per row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub booking_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Uuid>,
    pub provider: String,
    pub status: String,
    pub amount: i64,
    pub currency: String,
    pub created_at: String,
    pub updated_at: String,
    pub provider_txn_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_trans_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gateway_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_payload: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collected_by: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminPaymentListResponse {
    pub items: Vec<AdminPaymentOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams, ToSchema)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminPaymentsQuery {
    pub status: Option<String>,
    pub provider: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

/// Response of `PATCH /api/admin/payments/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePaymentStatusResponse {
    pub payment_id: Uuid,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub updated_at: String,
}

// ────────────────────────────────────────────────────────────────
//  IPN / webhook response DTOs
// ────────────────────────────────────────────────────────────────

/// Generic response shape returned by all IPN handlers. Different
/// providers expect different bodies — the route handler converts this
/// into the provider-specific response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IpnResponse {
    /// Provider-specific success code (e.g. `"00"` for VNPay, `0` for MoMo,
    /// `1` for ZaloPay).
    pub code: String,
    pub message: String,
}

// ────────────────────────────────────────────────────────────────
//  Validation helpers re-exported for the openapi schema
// ────────────────────────────────────────────────────────────────

/// Convenience: validator wrapper for phone numbers used by COD flow
/// (when collecting driver info). Re-exported so the routes don't need
/// to import the bare validator function.
pub fn validate_contact_phone(phone: &str) -> Result<(), AppError> {
    validate_phone(phone).map_err(|e| AppError::Validation(e.to_string()))
}
