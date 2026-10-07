//! DTOs for server-side ad-conversion reporting (`/api/ads/conversions`).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Google Ads click ids captured on landing (see
/// `frontend/src/lib/analytics.ts` — `captureClickIds`). At most one
/// is ever set per landing, but the beacon forwards whatever it has.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClickIds {
    /// Google Ads click id (Search/Display campaigns).
    pub gclid: Option<String>,
    /// Click id for Performance Max / App campaigns (web).
    pub wbraid: Option<String>,
    /// Click id for Performance Max / App campaigns (app, iOS-side).
    pub gbraid: Option<String>,
}

/// Request body for `POST /api/ads/conversions`.
///
/// The browser beacons this at the money moment (booking confirmed /
/// payment completed) alongside the click ids it captured on landing.
/// Fire-and-forget: the response only acknowledges storage — the
/// Google Ads API upload happens asynchronously and never blocks the
/// user's flow.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReportConversionRequest {
    /// Conversion event name — must match a key in the
    /// `GOOGLE_ADS_CONVERSION_ACTIONS` map (`booking` | `purchase`).
    pub event: String,
    /// Stable dedupe id — the booking code. Repeat beacons collapse.
    /// Optional: an id-less conversion can't be deduped (mirroring
    /// Google's own optional `orderId`) — the server mints a uuid so
    /// each fire is recorded distinctly.
    pub transaction_id: Option<String>,
    /// Revenue (decimal string, e.g. `"250000"` or `"250000.00"`) —
    /// kept verbatim so no float rounding reaches Google.
    pub value: Option<String>,
    /// ISO-4217 currency code (`VND`).
    pub currency: Option<String>,
    /// The landing click ids (attribution join key).
    #[serde(default)]
    pub click_ids: ClickIds,
}

/// Response of `POST /api/ads/conversions`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReportConversionResponse {
    pub ok: bool,
    /// Whether a NEW row was stored (false = deduped repeat beacon).
    pub stored: bool,
    /// Whether a server-side Google Ads upload was attempted.
    pub upload_attempted: bool,
    /// Whether the Google Ads API credentials are configured
    /// server-side. `false` = the record is stored and backfillable,
    /// but no upload happens yet.
    pub server_upload_enabled: bool,
}
