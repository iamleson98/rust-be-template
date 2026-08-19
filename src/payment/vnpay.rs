//! VNPay provider — builds the hosted-checkout URL with a HMAC-SHA512
//! signature, and exposes a verifier for the IPN callback.
//!
//! ## Wire format
//!
//! VNPay uses GET-only requests for the create-payment call. All params
//! (including the signature) travel in the query string of the payment
//! endpoint:
//!
//! ```text
//! https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=...&vnp_Command=pay&...&vnp_SecureHash=<HMAC_SHA512>
//! ```
//!
//! The signature is computed over all params **except `vnp_SecureHash`
//! and `vnp_SecureHashType`**, sorted alphabetically by key, URL-encoded
//! values, joined by `&`. We use `BTreeMap` for free alphabetical
//! ordering — same trick the VNPay SDK uses.
//!
//! ## IPN verification
//!
//! The IPN callback arrives as a GET with the same param set + `vnp_SecureHash`.
//! Verification = recompute the signature and constant-time compare. Always
//! trust the IPN, not the redirect URL (the redirect URL can be tampered
//! with by the user's browser).

use std::collections::BTreeMap;

use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha512;

use crate::config::VnpayConfig;
use crate::error::AppError;

use super::model::{build_memo, gen_txn_ref};
use super::provider::{CreatePaymentInput, Provider, ProviderResult};

type HmacSha512 = Hmac<Sha512>;

pub struct VnpayProvider {
    tmn_code: String,
    hash_secret: String,
    endpoint_base: String,
}

impl VnpayProvider {
    pub fn new(cfg: &VnpayConfig) -> Self {
        Self {
            tmn_code: cfg.tmn_code.clone(),
            hash_secret: cfg.hash_secret.clone(),
            endpoint_base: cfg.endpoint_base().to_string(),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.tmn_code.is_empty() && !self.hash_secret.is_empty()
    }
}

#[async_trait::async_trait]
impl Provider for VnpayProvider {
    fn name(&self) -> &'static str {
        super::providers::VNPAY
    }

    async fn create_payment(&self, input: &CreatePaymentInput) -> Result<ProviderResult, AppError> {
        if !self.is_configured() {
            return Err(AppError::ServiceUnavailable(
                "VNPay provider is not configured (missing tmn_code / hash_secret)".into(),
            ));
        }

        // VNPay expects `vnp_Amount` in VND integer đồng × 100 (cents).
        // VND has no subunits, but VNPay's API follows the ISO 4217 convention
        // of using the minor-unit amount. So 150000 VND → 15000000.
        let amount_x100 = input.amount * 100;

        let txn_ref = gen_txn_ref();
        let now = chrono::Utc::now();
        let create_date = now.format("%Y%m%d%H%M%S").to_string();
        let expire_date = (now + chrono::Duration::minutes(15))
            .format("%Y%m%d%H%M%S")
            .to_string();
        let order_info = build_memo(&input.booking_code);

        // Build the param map. BTreeMap gives alphabetical ordering for free.
        let mut params: BTreeMap<String, String> = BTreeMap::new();
        params.insert("vnp_Version".into(), "2.1.0".into());
        params.insert("vnp_Command".into(), "pay".into());
        params.insert("vnp_TmnCode".into(), self.tmn_code.clone());
        params.insert("vnp_Amount".into(), amount_x100.to_string());
        params.insert("vnp_CurrCode".into(), "VND".into());
        params.insert("vnp_TxnRef".into(), txn_ref.clone());
        params.insert("vnp_OrderInfo".into(), order_info.clone());
        params.insert("vnp_OrderType".into(), "other".into());
        params.insert("vnp_Locale".into(), "vn".into());
        params.insert("vnp_CreateDate".into(), create_date);
        params.insert("vnp_ExpireDate".into(), expire_date);
        params.insert("vnp_ReturnUrl".into(), input.return_url.clone());
        params.insert("vnp_IpnUrl".into(), input.ipn_url.clone());

        // Build the sign data: key=value pairs joined by `&`, URL-encoded
        // values, sorted alphabetically (BTreeMap gives us this for free).
        let sign_data: String = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, percent_encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        let secure_hash = hmac_sha512_hex(&self.hash_secret, sign_data.as_bytes());
        params.insert("vnp_SecureHash".into(), secure_hash.clone());
        params.insert("vnp_SecureHashType".into(), "HmacSHA512".into());

        // Build the final URL. The signature is appended last.
        let mut query: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, percent_encode(v)))
            .collect();
        query.sort();
        let gateway_url = format!("{}?{}", self.endpoint_base, query.join("&"));

        let provider_response = format!(
            "{{\"vnp_TxnRef\":\"{}\",\"vnp_Amount\":{},\"vnp_OrderInfo\":\"{}\"}}",
            txn_ref, amount_x100, order_info
        );

        Ok(ProviderResult {
            gateway_url: Some(gateway_url),
            qr_payload: None,
            qr_image_png: None,
            provider_txn_ref: txn_ref,
            provider_response,
        })
    }
}

impl VnpayProvider {
    /// Verify a VNPay IPN callback. Returns the verified params + the
    /// extracted transaction reference (`vnp_TxnRef`).
    ///
    /// Verification: recompute the HMAC-SHA512 over all received params
    /// except `vnp_SecureHash` / `vnp_SecureHashType`, sorted alphabetically,
    /// URL-encoded values, joined by `&`. Constant-time compare with the
    /// received `vnp_SecureHash`.
    ///
    /// Returns `(verified_params, txn_ref)` on success.
    pub fn verify_ipn(
        &self,
        params: &BTreeMap<String, String>,
    ) -> Result<(BTreeMap<String, String>, String), AppError> {
        let received_hash = params
            .get("vnp_SecureHash")
            .ok_or_else(|| AppError::BadRequest("missing vnp_SecureHash".into()))?
            .clone();

        // Build sign data from all params except the two hash fields.
        let sign_data: String = params
            .iter()
            .filter(|(k, _)| *k != "vnp_SecureHash" && *k != "vnp_SecureHashType")
            .map(|(k, v)| format!("{}={}", k, percent_encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        let computed = hmac_sha512_hex(&self.hash_secret, sign_data.as_bytes());

        // Constant-time compare to prevent timing attacks.
        if !constant_time_eq::constant_time_eq(computed.as_bytes(), received_hash.as_bytes()) {
            return Err(AppError::Unauthorized(
                "invalid vnp_SecureHash signature".into(),
            ));
        }

        let txn_ref = params
            .get("vnp_TxnRef")
            .ok_or_else(|| AppError::BadRequest("missing vnp_TxnRef".into()))?
            .clone();

        Ok((params.clone(), txn_ref))
    }
}

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────

/// HMAC-SHA512 over `data`, hex-encoded.
fn hmac_sha512_hex(key: &str, data: &[u8]) -> String {
    let mut mac = HmacSha512::new_from_slice(key.as_bytes()).expect("HMAC accepts any key length");
    mac.update(data);
    let bytes = mac.finalize().into_bytes();
    // VNPay uses lowercase hex.
    hex::encode(bytes)
}

/// Minimal percent-encoder for VNPay. VNPay's spec requires encoding
/// the same characters as RFC 3986's "unreserved" set + space as `%20`
/// (NOT `+`). We encode everything that isn't `A-Z a-z 0-9 - _ . ~`.
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// Re-export the standard base64 engine so the IPN route can encode
/// the verified response. Kept here so we don't add a separate
/// `base64` import elsewhere — `base64` is already a transitive dep
/// through `argon2`.
pub fn b64_encode(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_handles_vietnamese() {
        // Vietnamese tones get encoded as their UTF-8 byte sequence.
        assert_eq!(percent_encode("Vé xe"), "V%C3%A9%20xe");
    }

    #[test]
    fn hmac_sha512_is_deterministic() {
        let a = hmac_sha512_hex("secret", b"data");
        let b = hmac_sha512_hex("secret", b"data");
        assert_eq!(a, b);
        assert_ne!(a, hmac_sha512_hex("different", b"data"));
    }
}
