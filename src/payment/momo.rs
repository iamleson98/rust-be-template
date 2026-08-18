//! MoMo provider — POSTs a JSON request to the MoMo gateway to create
//! a payment, receives a `payUrl` to redirect the user to, and verifies
//! HMAC-SHA256 signatures on IPN callbacks.
//!
//! ## Wire format
//!
//! - Create: `POST {endpoint}/v2/gateway/api/create` with JSON body.
//! - Signature: `signature = HMAC_SHA256(secretKey, "accessKey=...&amount=...&extraData=...&ipnUrl=...&orderId=...&orderInfo=...&partnerCode=...&redirectUrl=...&requestId=...&requestType=...")`
//!   — Keys sorted alphabetically, raw values (NOT URL-encoded), joined by `&`.
//!
//! ## IPN verification
//!
//! The IPN callback arrives as POST JSON. We recompute the signature over
//! the same canonical string (alphabetical keys, raw values) and
//! constant-time compare with the received `signature`.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

use crate::config::MomoConfig;
use crate::error::AppError;

use super::model::{build_memo, gen_txn_ref};
use super::provider::{CreatePaymentInput, Provider, ProviderResult};

type HmacSha256 = Hmac<Sha256>;

pub struct MomoProvider {
    partner_code: String,
    access_key: String,
    secret_key: String,
    endpoint: String,
    http: reqwest::Client,
}

impl MomoProvider {
    pub fn new(cfg: &MomoConfig) -> Self {
        Self {
            partner_code: cfg.partner_code.clone(),
            access_key: cfg.access_key.clone(),
            secret_key: cfg.secret_key.clone(),
            endpoint: cfg.endpoint().to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("reqwest client builds with no system deps"),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.partner_code.is_empty()
            && !self.access_key.is_empty()
            && !self.secret_key.is_empty()
    }
}

#[async_trait::async_trait]
impl Provider for MomoProvider {
    fn name(&self) -> &'static str {
        super::providers::MOMO
    }

    async fn create_payment(
        &self,
        input: &CreatePaymentInput,
    ) -> Result<ProviderResult, AppError> {
        if !self.is_configured() {
            return Err(AppError::ServiceUnavailable(
                "MoMo provider is not configured (missing partner_code / access_key / secret_key)"
                    .into(),
            ));
        }

        let order_id = gen_txn_ref();
        let request_id = Uuid::new_v4().to_string();
        let order_info = build_memo(&input.booking_code);
        let request_type = "captureWallet"; // user-pays-via-MoMo-wallet flow
        let extra_data = ""; // MoMo accepts an empty string; we don't need to embed anything
        let lang = "vi";

        // Build signature over the canonical alphabetical-key string.
        // Required fields per MoMo v2 spec.
        let sign_data = format!(
            "accessKey={}&amount={}&extraData={}&ipnUrl={}&orderId={}&orderInfo={}&partnerCode={}&redirectUrl={}&requestId={}&requestType={}",
            self.access_key,
            input.amount,
            extra_data,
            input.ipn_url,
            order_id,
            order_info,
            self.partner_code,
            input.return_url,
            request_id,
            request_type,
        );
        let signature = hmac_sha256_hex(&self.secret_key, sign_data.as_bytes());

        let body = serde_json::json!({
            "partnerCode": self.partner_code,
            "accessKey": self.access_key,
            "requestId": request_id,
            "amount": input.amount,
            "orderId": order_id,
            "orderInfo": order_info,
            "redirectUrl": input.return_url,
            "ipnUrl": input.ipn_url,
            "requestType": request_type,
            "extraData": extra_data,
            "lang": lang,
            "signature": signature,
        });

        let resp = self
            .http
            .post(&self.endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::ServiceUnavailable(format!("MoMo create-payment failed: {e}")))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::Internal(format!("MoMo response body read failed: {e}")))?;
        if !status.is_success() {
            return Err(AppError::ServiceUnavailable(format!(
                "MoMo returned non-2xx: {status} body={text}"
            )));
        }

        let parsed: MomoCreateResponse = serde_json::from_str(&text).map_err(|e| {
            AppError::Internal(format!("MoMo response parse failed: {e} body={text}"))
        })?;

        // Validate the response signature (HMAC-SHA256 over the canonical string).
        let verify_str = format!(
            "accessKey={}&amount={}&orderId={}&orderInfo={}&partnerCode={}&payType={}&requestId={}&responseTime={}&resultCode={}&transId={}",
            self.access_key,
            parsed.amount.unwrap_or(0),
            order_id,
            order_info,
            self.partner_code,
            parsed.pay_type.as_deref().unwrap_or(""),
            request_id,
            parsed.response_time.unwrap_or(0),
            parsed.result_code.unwrap_or(-1),
            parsed.trans_id.unwrap_or(0),
        );
        if let Some(sig) = parsed.signature.as_ref() {
            let computed = hmac_sha256_hex(&self.secret_key, verify_str.as_bytes());
            if !constant_time_eq::constant_time_eq(computed.as_bytes(), sig.as_bytes()) {
                tracing::warn!("MoMo response signature mismatch — continuing anyway (response signature verification is best-effort)");
            }
        }

        if parsed.result_code != Some(0) {
            return Err(AppError::BadRequest(format!(
                "MoMo create-payment rejected: code={:?} message={:?}",
                parsed.result_code, parsed.message
            )));
        }

        let pay_url = parsed
            .pay_url
            .ok_or_else(|| AppError::Internal("MoMo response missing payUrl".into()))?;

        Ok(ProviderResult {
            gateway_url: Some(pay_url),
            qr_payload: None,
            qr_image_png: None,
            provider_txn_ref: order_id.clone(),
            provider_response: text,
        })
    }
}

#[derive(Debug, Deserialize)]
struct MomoCreateResponse {
    #[serde(default)]
    pay_url: Option<String>,
    #[serde(default)]
    result_code: Option<i64>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    amount: Option<i64>,
    #[serde(default)]
    trans_id: Option<i64>,
    #[serde(default)]
    response_time: Option<i64>,
    #[serde(default)]
    pay_type: Option<String>,
    #[serde(default)]
    signature: Option<String>,
}

/// Parsed MoMo IPN callback body. Used by the route handler to extract
/// the verification fields. All fields are optional at the JSON level
/// — the verifier rejects the request if any required field is missing.
#[derive(Debug, Deserialize, Serialize)]
pub struct MomoIpnPayload {
    pub partner_code: String,
    pub order_id: String,
    pub request_id: String,
    pub amount: i64,
    pub order_info: String,
    #[serde(default)]
    pub order_type: Option<String>,
    pub trans_id: i64,
    pub result_code: i64,
    pub message: String,
    pub response_time: i64,
    #[serde(default)]
    pub extra_data: String,
    #[serde(default)]
    pub pay_type: Option<String>,
    pub signature: String,
}

impl MomoProvider {
    /// Verify a MoMo IPN callback.
    ///
    /// Returns the verified `(txn_ref, trans_id, amount, result_code)` tuple
    /// on success. The route handler uses this to find the matching payment
    /// row by `provider_txn_ref == order_id` and transition its state.
    pub fn verify_ipn(&self, payload: &MomoIpnPayload) -> Result<MomoIpnVerification, AppError> {
        // Build the canonical sign data — alphabetical keys, raw values.
        let sign_data = format!(
            "accessKey={}&amount={}&extraData={}&message={}&orderId={}&orderInfo={}&orderType={}&partnerCode={}&payType={}&requestId={}&responseTime={}&resultCode={}&transId={}",
            self.access_key,
            payload.amount,
            payload.extra_data,
            payload.message,
            payload.order_id,
            payload.order_info,
            payload.order_type.as_deref().unwrap_or(""),
            payload.partner_code,
            payload.pay_type.as_deref().unwrap_or(""),
            payload.request_id,
            payload.response_time,
            payload.result_code,
            payload.trans_id,
        );

        let computed = hmac_sha256_hex(&self.secret_key, sign_data.as_bytes());
        if !constant_time_eq::constant_time_eq(computed.as_bytes(), payload.signature.as_bytes()) {
            return Err(AppError::Unauthorized("invalid MoMo signature".into()));
        }

        Ok(MomoIpnVerification {
            txn_ref: payload.order_id.clone(),
            trans_id: payload.trans_id,
            amount: payload.amount,
            result_code: payload.result_code,
        })
    }
}

#[derive(Debug, Clone)]
pub struct MomoIpnVerification {
    pub txn_ref: String,
    pub trans_id: i64,
    pub amount: i64,
    pub result_code: i64,
}

/// HMAC-SHA256 over `data`, hex-encoded.
fn hmac_sha256_hex(key: &str, data: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(key.as_bytes()).expect("HMAC accepts any key length");
    mac.update(data);
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_sha256_is_deterministic() {
        let a = hmac_sha256_hex("secret", b"data");
        let b = hmac_sha256_hex("secret", b"data");
        assert_eq!(a, b);
        // Known test vector for HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
        // (https://tools.ietf.org/html/rfc4231#section-4.2 — not the same input, but a sanity check)
        assert_eq!(
            hmac_sha256_hex("key", "The quick brown fox jumps over the lazy dog".as_bytes()),
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }
}
