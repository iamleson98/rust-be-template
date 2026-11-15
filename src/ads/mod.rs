//! Ads hub — the server-side half of Google Ads conversion tracking.
//!
//! The browser half lives in `frontend/src/lib/analytics.ts` (gtag
//! dispatch + click-id capture). This module completes the pipeline
//! with the piece gtag cannot do: durable first-party conversion
//! records + (config-gated) upload to the Google Ads API
//! `customers/{cid}:uploadClickConversions`, which measures
//! conversions that browser-side tags lose to cookie blocking, ITP,
//! and cross-device journeys.
//!
//! ## Design (follows the push-hub precedent)
//!
//! * Process-global singleton (`OnceLock`) — initialised at server
//!   boot with the DB pool + the `GOOGLE_ADS_*` env group; routes are
//!   thin wrappers (`crate::ads::ads().record(...)`), so no
//!   `AppState`/composition-root churn.
//! * **Config-gated**: without the full credential group every upload
//!   is a cheap no-op — but records are STILL stored (`status =
//!   "unconfigured"`), so enabling credentials later + calling
//!   [`AdsHub::sweep`] backfills the whole backlog.
//! * Uploads are `tokio::spawn`ed fire-and-forget — measurement never
//!   blocks the money moment (the beacon's HTTP response returns as
//!   soon as the row is durable).
//! * Dedupe at the storage boundary: `(event, transaction_id)` is
//!   unique, so the browser may retry the beacon freely.
//! * The beacon is public (it fires after the session may have lapsed), so
//!   it is trusted for nothing but the click ids: a conversion must name a
//!   real booking by its code, a `purchase` needs a completed payment, and
//!   the value and currency are read from the database
//!   ([`AdsHub::report`]).
//!
//! ## The credential group (see `.env.example` / `docs/GOOGLE_ADS.md`)
//!
//! `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`,
//! `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`,
//! `GOOGLE_ADS_REFRESH_TOKEN` (an offline-access OAuth grant for the
//! API scope) and `GOOGLE_ADS_CONVERSION_ACTIONS` — the JSON map from
//! event name to conversion-action resource name, mirroring the
//! browser-side `VITE_GOOGLE_ADS_CONVERSIONS` labels.

use std::sync::{Arc, OnceLock};

use sea_orm::DatabaseConnection;

use crate::dto::ad_conversion::{ReportConversionRequest, ReportConversionResponse};
use crate::error::AppError;
use crate::store::{
    AdConversionStore, BookingStore, DbAdConversionStore, DbBookingStore, NewAdConversion,
    StoreError,
};

/// The conversions the site reports: a booking held, a booking paid.
const EVENTS: [&str; 2] = ["booking", "purchase"];

/// The longest booking code accepted as a transaction id.
const MAX_TRANSACTION_ID_LEN: usize = 128;

/// Click ids are opaque tokens (typically ~100 chars); the stored length
/// is capped so a hostile beacon can't bloat rows.
const MAX_CLICK_ID_LEN: usize = 1024;

/// Record + attempt outcome for the route's response.
#[derive(Debug)]
pub struct RecordOutcome {
    /// Whether a NEW row was stored (false = deduped by
    /// `(event, transaction_id)` — the repeat beacon collapsed).
    pub stored: bool,
    /// Whether a Google Ads API upload was actually attempted (requires
    /// credentials + at least one click id + a mapped action).
    pub upload_attempted: bool,
}

/// Process-global ads hub.
pub struct AdsHub {
    conversions: Arc<DbAdConversionStore>,
    bookings: DbBookingStore,
    api: Option<GoogleAdsApi>,
}

static ADS: OnceLock<AdsHub> = OnceLock::new();

/// Initialise the hub at server boot. `None` credentials →
/// record-only mode (uploads stay `unconfigured`, logged once).
pub fn init(db: Arc<DatabaseConnection>, api: Option<GoogleAdsApi>) {
    let hub = AdsHub::new(db, api);
    if hub.api.is_none() {
        tracing::info!(
            "ads: GOOGLE_ADS_* credentials incomplete — conversion recording only \
             (no server-side upload; rows stay backfillable)"
        );
    }
    let _ = ADS.set(hub);
}

/// The process-global hub. Panics only when a route runs before boot
/// initialised it — impossible in practice (routes are nested inside
/// the booted router), same contract as `crate::push::push()`.
pub fn ads() -> &'static AdsHub {
    ADS.get().expect("ads hub initialised at boot")
}

impl AdsHub {
    pub fn new(db: Arc<DatabaseConnection>, api: Option<GoogleAdsApi>) -> Self {
        Self {
            conversions: Arc::new(DbAdConversionStore::new(db.clone())),
            bookings: DbBookingStore::new(db),
            api,
        }
    }

    /// Whether the Google Ads API credential group is complete (and
    /// thus server-side uploads happen). Surfaced by the beacon
    /// response so ops can verify the pipeline is live end-to-end.
    pub fn is_upload_enabled(&self) -> bool {
        self.api.is_some()
    }

    /// Verify and record a beacon from the browser.
    ///
    /// Only `booking` and `purchase` events are accepted, and
    /// `transaction_id` must be the code of a real, uncancelled booking
    /// (`purchase`: one with a completed payment). The beacon's own
    /// `value` and `currency` are ignored: they come from the booking or
    /// its payment, so a forged beacon can neither invent revenue nor
    /// write rows for bookings that do not exist.
    pub async fn report(
        &self,
        req: ReportConversionRequest,
    ) -> Result<ReportConversionResponse, AppError> {
        let event = req.event.trim().to_lowercase();
        if !EVENTS.contains(&event.as_str()) {
            return Err(AppError::BadRequest(format!(
                "event must be one of {}",
                EVENTS.join(", ")
            )));
        }
        let code = req.transaction_id.as_deref().map(str::trim).unwrap_or("");
        if code.is_empty() || code.len() > MAX_TRANSACTION_ID_LEN {
            return Err(AppError::BadRequest(
                "transactionId must be a booking code".into(),
            ));
        }
        let (amount, currency) = self
            .bookings
            .conversion_value(code, event == "purchase")
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound(format!("no {event} for this booking")))?;

        let click_ids = req.click_ids;
        let outcome = self
            .record(NewAdConversion {
                event,
                transaction_id: code.to_string(),
                conversion_value: Some(amount.to_string()),
                currency: Some(currency.to_uppercase()),
                gclid: click_id(click_ids.gclid),
                wbraid: click_id(click_ids.wbraid),
                gbraid: click_id(click_ids.gbraid),
            })
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(ReportConversionResponse {
            ok: true,
            stored: outcome.stored,
            upload_attempted: outcome.upload_attempted,
            server_upload_enabled: self.is_upload_enabled(),
        })
    }

    /// Persist a conversion (deduped) and kick an upload attempt when
    /// possible. The upload itself never blocks the caller.
    pub async fn record(&self, c: NewAdConversion) -> Result<RecordOutcome, StoreError> {
        let (model, stored) = self.conversions.insert_deduped(c).await?;
        let has_click_id =
            model.gclid.is_some() || model.wbraid.is_some() || model.gbraid.is_some();
        let attempt = self.api.is_some() && has_click_id;

        if stored && attempt {
            let api = self.api.clone().expect("checked above");
            let store = self.conversions.clone();
            tokio::spawn(async move {
                match api.upload(&model).await {
                    Ok(()) => {
                        let _ = store.mark_status(model.id, "uploaded").await;
                    }
                    Err(e) => {
                        tracing::warn!("ads: conversion upload failed ({}): {e}", model.event);
                        let _ = store.mark_status(model.id, "error").await;
                    }
                }
            });
        } else if stored && self.api.is_none() {
            let _ = self.conversions.mark_status(model.id, "unconfigured").await;
        } else if stored && !has_click_id {
            // Organic conversion (no ad click behind it) — nothing to
            // attribute server-side; keep the record for reporting.
            let _ = self.conversions.mark_status(model.id, "skipped").await;
        }

        Ok(RecordOutcome {
            stored,
            upload_attempted: attempt,
        })
    }

    /// Backfill pass: retry every unfinished row (pending / error /
    /// unconfigured) against the configured API — call after enabling
    /// credentials, e.g. from the CLI or a future scheduled job.
    /// Returns the number of rows that reached `uploaded`.
    pub async fn sweep(&self, limit: u64) -> Result<u64, StoreError> {
        let Some(api) = self.api.as_ref() else {
            return Ok(0);
        };
        let rows = self.conversions.list_unfinished(limit).await?;
        let mut uploaded = 0u64;
        for m in rows {
            let has_click_id = m.gclid.is_some() || m.wbraid.is_some() || m.gbraid.is_some();
            if !has_click_id {
                let _ = self.conversions.mark_status(m.id, "skipped").await;
                continue;
            }
            match api.upload(&m).await {
                Ok(()) => {
                    let _ = self.conversions.mark_status(m.id, "uploaded").await;
                    uploaded += 1;
                }
                Err(e) => {
                    tracing::warn!("ads: backfill upload failed ({}): {e}", m.event);
                    let _ = self.conversions.mark_status(m.id, "error").await;
                }
            }
        }
        Ok(uploaded)
    }
}

/// A click id as stored: trimmed; blank or over-long becomes absent.
fn click_id(id: Option<String>) -> Option<String> {
    id.map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() <= MAX_CLICK_ID_LEN)
}

/// A ready-to-use Google Ads API client (refresh-token OAuth).
#[derive(Clone)]
pub struct GoogleAdsApi {
    http: reqwest::Client,
    cfg: crate::config::GoogleAdsConfig,
    /// Cached access token + its expiry (refresh-token grants live
    /// ~1h; refreshed lazily — the token endpoint tolerates
    /// concurrent refreshes, so no cross-call single-flight needed).
    token: Arc<tokio::sync::Mutex<Option<(String, std::time::Instant)>>>,
}

impl GoogleAdsApi {
    /// Build from a COMPLETE config group; callers gate on
    /// [`crate::config::GoogleAdsConfig::is_active`].
    pub fn new(cfg: crate::config::GoogleAdsConfig) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("reqwest client"),
            cfg,
            token: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    async fn access_token(&self) -> Result<String, String> {
        let mut guard = self.token.lock().await;
        if let Some((tok, exp)) = guard.as_ref() {
            // Refresh a minute early — a token that expires mid-request
            // fails the whole upload.
            if std::time::Instant::now() < *exp {
                return Ok(tok.clone());
            }
        }
        let resp = self
            .http
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", self.cfg.refresh_token.as_str()),
                ("client_id", self.cfg.client_id.as_str()),
                ("client_secret", self.cfg.client_secret.as_str()),
            ])
            .send()
            .await
            .map_err(|e| format!("oauth: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("oauth status {}", resp.status()));
        }
        let json: serde_json::Value = resp.json().await.map_err(|e| format!("oauth body: {e}"))?;
        let tok = json["access_token"]
            .as_str()
            .ok_or("oauth: no access_token")?
            .to_string();
        let secs = json["expires_in"].as_i64().unwrap_or(3600).max(60) as u64;
        *guard = Some((
            tok.clone(),
            std::time::Instant::now() + std::time::Duration::from_secs(secs),
        ));
        Ok(tok)
    }

    /// The `uploadClickConversions` endpoint of the configured API version
    /// (`GOOGLE_ADS_API_VERSION`; Google retires old versions, so the
    /// version is configuration, not code).
    pub fn upload_url(&self) -> String {
        format!(
            "https://googleads.googleapis.com/{}/customers/{}:uploadClickConversions",
            self.cfg.api_version, self.cfg.customer_id
        )
    }

    /// Upload one conversion via
    /// `POST /{version}/customers/{cid}:uploadClickConversions`.
    async fn upload(&self, m: &crate::entity::ad_conversion::Model) -> Result<(), String> {
        let action = self
            .cfg
            .conversion_actions
            .get(&m.event)
            .ok_or_else(|| format!("no conversion action mapped for event '{}'", m.event))?;
        let conversion_date_time = conversion_datetime(&m.created_at)?;
        let token = self.access_token().await?;

        let mut conv = serde_json::json!({
            "conversionAction": action,
            "conversionDateTime": conversion_date_time,
            "orderId": m.transaction_id,
        });
        if let Some(v) = m.conversion_value.as_deref() {
            conv["conversionValue"] = serde_json::Value::String(v.to_string());
        }
        if let Some(c) = m.currency.as_deref() {
            conv["currencyCode"] = serde_json::Value::String(c.to_string());
        }
        // Click ids: at most one of gclid/wbraid/gbraid may be set per
        // conversion (Google's rule) — prefer gclid, then wbraid, gbraid.
        if let Some(g) = m.gclid.as_deref() {
            conv["gclid"] = serde_json::Value::String(g.to_string());
        } else if let Some(w) = m.wbraid.as_deref() {
            conv["wbraid"] = serde_json::Value::String(w.to_string());
        } else if let Some(g) = m.gbraid.as_deref() {
            conv["gbraid"] = serde_json::Value::String(g.to_string());
        }

        let mut req = self
            .http
            .post(self.upload_url())
            .bearer_auth(&token)
            .header("developer-token", &self.cfg.developer_token)
            .json(&serde_json::json!({
                "conversions": [conv],
                "partialFailure": true,
            }));
        if let Some(login) = self.cfg.login_customer_id.as_deref() {
            req = req.header("login-customer-id", login);
        }
        let resp = req.send().await.map_err(|e| format!("upload: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "upload rejected: {}",
                body.chars().take(500).collect::<String>()
            ));
        }
        Ok(())
    }
}

/// Google requires `YYYY-MM-DD HH:MM:SS±HH:MM` (offset mandatory for
/// click conversions). Our rows store RFC-3339 (`2026-10-07T04:00:00
/// +00:00`, possibly with fractional seconds) — normalise to the API
/// shape.
fn conversion_datetime(rfc3339: &str) -> Result<String, String> {
    let dt = chrono::DateTime::parse_from_rfc3339(rfc3339)
        .map_err(|e| format!("bad created_at '{rfc3339}': {e}"))?;
    Ok(dt.format("%Y-%m-%d %H:%M:%S%:z").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversion_datetime_formats_rfc3339_with_offset() {
        assert_eq!(
            conversion_datetime("2026-10-07T04:15:30.123456789+00:00").unwrap(),
            "2026-10-07 04:15:30+00:00"
        );
        assert_eq!(
            conversion_datetime("2026-10-07T11:00:00+07:00").unwrap(),
            "2026-10-07 11:00:00+07:00"
        );
    }

    #[test]
    fn conversion_datetime_rejects_garbage() {
        assert!(conversion_datetime("not a date").is_err());
        assert!(conversion_datetime("").is_err());
    }
}
