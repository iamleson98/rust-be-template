//! Payment provider trait + shared types.
//!
//! Each provider (VNPay, MoMo, ZaloPay, VietQR, COD) is implemented in
//! its own submodule under `crate::payment::*`. The service layer
//! dispatches based on the `payment.provider` string column.
//!
//! ## Security conventions
//!
//! - All HMAC signatures are computed over the **exact byte sequence** the
//!   gateway will receive. We never pre-URL-encode then sign — VNPay and MoMo
//!   disagree on encoding rules, so each provider has its own canonicaliser.
//! - Secrets come from `Config::payment` (env-driven). They never appear in
//!   logs (masked by `cli::util::mask_secret`) or in API responses.
//! - Webhook/IPN handlers **always re-verify the signature** before trusting
//!   the request body. Never trust the gateway's redirect URL alone.
//! - Idempotency is enforced by `payment.provider_txn_ref` (UNIQUE constraint)
//!   and the payment state machine. A duplicate IPN for an already-completed
//!   payment is a no-op.

use crate::error::AppError;

/// Inputs shared across all providers. Built by the `PaymentService` from
/// a `payment::Model` + the booking it belongs to.
#[derive(Debug, Clone)]
pub struct CreatePaymentInput {
    /// `payment.id` (UUID string) — used as the order id for providers
    /// that don't have their own (VNPay/MoMo use this as `vnp_TxnRef` /
    /// `orderId`).
    pub payment_id: String,
    /// Human-readable booking code (e.g. `VEXEVN-AB12CD`). Embedded in
    /// the gateway's order description + the VietQR memo so the user can
    /// recognise the charge on their bank statement.
    pub booking_code: String,
    /// Amount in VND integer đồng (no decimals).
    pub amount: i64,
    /// ISO 4217 currency code. Always `VND` for now, but kept in the
    /// struct so we can support USD/EUR later without touching the trait.
    pub currency: String,
    /// Public-facing return URL — the gateway redirects here after the
    /// user completes the payment. Read from `Config::payment::public_base_url`.
    pub return_url: String,
    /// IPN webhook URL — the gateway POSTs the payment result here.
    /// Always server-side (not the user's browser).
    pub ipn_url: String,
    /// Optional memo / `addInfo`. For VietQR, embedded in the QR. For
    /// VNPay, used as `vnp_OrderInfo`. For MoMo/ZaloPay, used as `orderInfo`.
    pub memo: String,
}

/// The outcome of [`Provider::create_payment`] — what the route handler
/// returns to the client.
#[derive(Debug, Clone)]
pub struct ProviderResult {
    /// For VNPay/MoMo/ZaloPay: hosted checkout URL the user is redirected to.
    /// For VietQR/COD: `None`.
    pub gateway_url: Option<String>,
    /// For VietQR: the EMV QR TLV string. For other providers: `None`.
    pub qr_payload: Option<String>,
    /// For VietQR: PNG bytes of the rendered QR. Pre-rendered server-side
    /// so the front-end doesn't need to pull a QR library. Encoded as a
    /// `data:image/png;base64,...` URI by the service.
    pub qr_image_png: Option<Vec<u8>>,
    /// Provider-side transaction reference (the value of `vnp_TxnRef` /
    /// `orderId` / `app_trans_id`). Stored on `payment.provider_txn_ref`.
    pub provider_txn_ref: String,
    /// Raw provider response (JSON or query string). Stored on
    /// `payment.provider_response` for audit.
    pub provider_response: String,
}

/// Provider trait — every gateway implements this. The service dispatches
/// based on the `payment.provider` string column.
///
/// ## Concurrency
///
/// All methods are `async` because providers may need to make outbound HTTP
/// calls (VNPay/MoMo/ZaloPay create-order endpoints). VietQR and COD have
/// no network calls and return immediately.
#[async_trait::async_trait]
pub trait Provider: Send + Sync {
    /// Provider identifier — must match `payment.providers::*`.
    fn name(&self) -> &'static str;

    /// Initiate a payment. Returns the gateway URL or QR payload that
    /// the front-end will use to render the payment UI.
    async fn create_payment(&self, input: &CreatePaymentInput) -> Result<ProviderResult, AppError>;
}
