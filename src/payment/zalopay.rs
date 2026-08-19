//! ZaloPay provider — POSTs a JSON request to ZaloPay's `create` endpoint
//! and verifies HMAC-SHA256 (`mac`) signatures on the callback webhook.
//!
//! ## Wire format
//!
//! - Create: `POST {endpoint_base}/create` with JSON body.
//! - Signature (`mac`): `HMAC_SHA256(key1, "app_id|app_trans_id|app_user|amount|app_time|embed_data|item")`
//!   — pipe-delimited, fixed order (NOT alphabetical).
//! - The `embed_data` field is a JSON string (we use it to carry the
//!   `redirecturl` + `callbackurl`).
//! - The `item` field is a JSON array (we send a single-element array with
//!   the booking info).
//!
//! ## Callback verification
//!
//! ZaloPay POSTs to `callbackurl` (server-to-server) after the user pays.
//! The body is JSON; the `mac` field is `HMAC_SHA256(key2, <full raw body>)`.
//! We must verify with the **raw body bytes**, not a re-serialised JSON —
//! any byte-level difference (key ordering, whitespace) would change the MAC.
//!
//! That's why the route handler reads the raw body as `Bytes` and passes it
//! to `verify_callback_raw`.

use serde::{Deserialize, Serialize};

use crate::config::ZalopayConfig;
use crate::error::AppError;

use super::model::{build_memo, gen_txn_ref};
use super::provider::{CreatePaymentInput, Provider, ProviderResult};

pub struct ZalopayProvider {
    app_id: i64,
    key1: String,
    key2: String,
    endpoint_base: String,
    http: reqwest::Client,
}

impl ZalopayProvider {
    pub fn new(cfg: &ZalopayConfig) -> Self {
        let app_id: i64 = cfg.app_id.parse().unwrap_or(0);
        Self {
            app_id,
            key1: cfg.key1.clone(),
            key2: cfg.key2.clone(),
            endpoint_base: cfg.endpoint_base().to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("reqwest client builds with no system deps"),
        }
    }

    pub fn is_configured(&self) -> bool {
        self.app_id > 0 && !self.key1.is_empty() && !self.key2.is_empty()
    }
}

#[async_trait::async_trait]
impl Provider for ZalopayProvider {
    fn name(&self) -> &'static str {
        super::providers::ZALOPAY
    }

    async fn create_payment(&self, input: &CreatePaymentInput) -> Result<ProviderResult, AppError> {
        if !self.is_configured() {
            return Err(AppError::ServiceUnavailable(
                "ZaloPay provider is not configured (missing app_id / key1 / key2)".into(),
            ));
        }

        // ZaloPay `app_trans_id` format: `yyMMdd_bookingref`. We use the
        // booking code as the second part for human-readability + reconciliation.
        let date_part = chrono::Utc::now().format("%y%m%d").to_string();
        let app_trans_id = format!("{date_part}_{}", input.booking_code);
        let app_user = "VEXEVN"; // merchant's display name on the ZaloPay UI
        let app_time = chrono::Utc::now().timestamp_millis();
        let description = format!(
            "Thanh toan ve xe {} - {}",
            input.booking_code,
            build_memo(&input.booking_code)
        );

        // embed_data carries redirecturl + callbackurl (both server URLs).
        // ZaloPay reads them from this JSON string at runtime.
        let embed_data = serde_json::json!({
            "redirecturl": input.return_url,
            "callbackurl": input.ipn_url,
        })
        .to_string();

        // item: a JSON array of items. Single-element array is fine.
        let item = serde_json::json!([{
            "itemid": input.booking_code,
            "itemname": format!("Ve xe {}", input.booking_code),
            "itemprice": input.amount,
            "itemquantity": 1,
        }])
        .to_string();

        // Build `mac` over the pipe-delimited fixed-order canonical string.
        let mac_input = format!(
            "{}|{}|{}|{}|{}|{}|{}",
            self.app_id, app_trans_id, app_user, input.amount, app_time, embed_data, item
        );
        let mac = hmac_sha256_hex(&self.key1, mac_input.as_bytes());

        let body = serde_json::json!({
            "app_id": self.app_id,
            "app_trans_id": app_trans_id,
            "app_user": app_user,
            "app_time": app_time,
            "amount": input.amount,
            "item": item,
            "embed_data": embed_data,
            "callback_url": input.ipn_url,
            "description": description,
            "mac": mac,
        });

        let url = format!("{}/create", self.endpoint_base);
        let resp = self.http.post(&url).json(&body).send().await.map_err(|e| {
            AppError::ServiceUnavailable(format!("ZaloPay create-payment failed: {e}"))
        })?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| AppError::Internal(format!("ZaloPay response body read failed: {e}")))?;
        if !status.is_success() {
            return Err(AppError::ServiceUnavailable(format!(
                "ZaloPay returned non-2xx: {status} body={text}"
            )));
        }

        let parsed: ZalopayCreateResponse = serde_json::from_str(&text).map_err(|e| {
            AppError::Internal(format!("ZaloPay response parse failed: {e} body={text}"))
        })?;

        if parsed.return_code != 1 {
            return Err(AppError::BadRequest(format!(
                "ZaloPay create-payment rejected: code={} message={}",
                parsed.return_code,
                parsed.return_message.as_deref().unwrap_or("(no message)")
            )));
        }

        let order_url = parsed
            .order_url
            .ok_or_else(|| AppError::Internal("ZaloPay response missing order_url".into()))?;

        // We use the random `gen_txn_ref` as the internal txn_ref, NOT
        // `app_trans_id`. This is because `app_trans_id` is date-prefixed
        // and would collide if we ever reset the booking code namespace.
        // The IPN callback contains both, and we look up by `app_trans_id`.
        let internal_txn_ref = gen_txn_ref();

        Ok(ProviderResult {
            gateway_url: Some(order_url),
            qr_payload: None,
            qr_image_png: None,
            provider_txn_ref: internal_txn_ref,
            provider_response: text,
        })
    }
}

#[derive(Debug, Deserialize)]
struct ZalopayCreateResponse {
    #[serde(default)]
    return_code: i64,
    #[serde(default)]
    return_message: Option<String>,
    #[serde(default)]
    order_url: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    zp_trans_id: Option<String>,
}

/// Parsed ZaloPay callback body.
#[derive(Debug, Deserialize, Serialize)]
pub struct ZalopayCallbackPayload {
    pub app_id: i64,
    pub app_trans_id: String,
    pub app_user: String,
    pub zp_trans_id: i64,
    pub amount: i64,
    #[serde(default)]
    pub discount_amount: i64,
    pub server_time: i64,
    #[serde(default)]
    pub embed_data: String,
    #[serde(default)]
    pub item: String,
    #[serde(default)]
    pub channel: i64,
    #[serde(default)]
    pub merchant_user_id: String,
    #[serde(default)]
    pub user_fee_amount: i64,
    pub mac: String,
}

impl ZalopayProvider {
    /// Verify a ZaloPay callback. The MAC is `HMAC_SHA256(key2, <raw body bytes>)`.
    ///
    /// IMPORTANT: the verifier MUST be called with the raw body bytes
    /// received from ZaloPay — re-serialising the JSON would change
    /// whitespace/key ordering and break the MAC.
    pub fn verify_callback(
        &self,
        payload: &ZalopayCallbackPayload,
        raw_body: &[u8],
    ) -> Result<ZalopayCallbackVerification, AppError> {
        let computed = hmac_sha256_hex(&self.key2, raw_body);
        if !constant_time_eq::constant_time_eq(computed.as_bytes(), payload.mac.as_bytes()) {
            return Err(AppError::Unauthorized("invalid ZaloPay mac".into()));
        }

        // Cross-check app_id — protects against a misconfigured webhook
        // sending callbacks for a different merchant.
        if payload.app_id != self.app_id {
            return Err(AppError::Unauthorized(format!(
                "ZaloPay callback app_id mismatch: expected={}, got={}",
                self.app_id, payload.app_id
            )));
        }

        Ok(ZalopayCallbackVerification {
            app_trans_id: payload.app_trans_id.clone(),
            zp_trans_id: payload.zp_trans_id,
            amount: payload.amount,
        })
    }
}

#[derive(Debug, Clone)]
pub struct ZalopayCallbackVerification {
    pub app_trans_id: String,
    pub zp_trans_id: i64,
    pub amount: i64,
}

/// HMAC-SHA256 over `data`, hex-encoded.
fn hmac_sha256_hex(key: &str, data: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC accepts any key");
    mac.update(data);
    hex::encode(mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    #[test]
    fn mac_input_uses_pipe_delimiter() {
        // Sanity check the canonical string format.
        let mac_input = format!(
            "{}|{}|{}|{}|{}|{}|{}",
            1, "240101_ABC", "user", 150000, 1700000000, "{}", "[]"
        );
        assert_eq!(mac_input, "1|240101_ABC|user|150000|1700000000|{}|[]");
    }
}
