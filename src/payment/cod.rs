//! COD (cash-on-boarding) provider — no gateway interaction. The booking
//! is held until the driver / agent collects cash when the passenger
//! boards the bus.
//!
//! ## What this provider does
//!
//! - `create_payment` returns immediately with status `pending` (no
//!   `gateway_url`, no `qr_payload`). The payment remains pending until
//!   the driver marks it as collected via the admin route.
//! - The booking is NOT auto-confirmed on payment creation — it stays
//!   `pending` (held seats). The COD payment transitions to `completed`
//!   when the driver collects the cash, at which point the booking is
//!   also marked `confirmed`.
//!
//! ## What this provider does NOT do
//!
//! - No signature / HMAC — there's no gateway to authenticate.
//! - No IPN webhook.
//! - No refund flow — refunds are manual (cash returned to passenger).

use super::model::gen_txn_ref;
use super::provider::{CreatePaymentInput, Provider, ProviderResult};
use crate::error::AppError;

pub struct CodProvider;

impl CodProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CodProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl Provider for CodProvider {
    fn name(&self) -> &'static str {
        super::providers::COD
    }

    async fn create_payment(&self, input: &CreatePaymentInput) -> Result<ProviderResult, AppError> {
        // For COD there's no gateway interaction. We just record the
        // intent-to-pay-cash and let the booking hold keep the seats.
        //
        // The `provider_txn_ref` is a random internal id — never sent
        // to a gateway, only used for our own DB uniqueness constraint.
        let txn_ref = gen_txn_ref();
        Ok(ProviderResult {
            gateway_url: None,
            qr_payload: None,
            qr_image_png: None,
            provider_txn_ref: txn_ref,
            provider_response: format!(
                "{{\"provider\":\"cod\",\"booking_code\":\"{}\"}}",
                input.booking_code
            ),
        })
    }
}
