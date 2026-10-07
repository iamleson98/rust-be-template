//! Ads routes — `POST /api/ads/conversions` (server-side conversion
//! recording for Google Ads).
//!
//! The SPA calls this from `trackConversion()` (see
//! `frontend/src/lib/analytics.ts`) via `navigator.sendBeacon` at the
//! money moment, forwarding the click ids captured on landing. The
//! hub (`crate::ads`) persists the record (deduped) and, when the
//! `GOOGLE_ADS_*` credential group is configured, uploads it to the
//! Google Ads API asynchronously — measurement never blocks the flow.
//!
//! Auth note: `MaybeAuthUser`, deliberately. The beacon rides on the
//! booking/payment session, which can expire in the seconds between
//! the money moment and the beacon — a measurement record carrying
//! zero PII (event, value, click ids) must not be lost to that.

use axum::extract::State;
use axum::Json;

use crate::dto::ad_conversion::{ClickIds, ReportConversionRequest, ReportConversionResponse};
use crate::error::AppError;
use crate::middleware::MaybeAuthUser;
use crate::state::AppState;
use crate::store::NewAdConversion;

/// `POST /api/ads/conversions` — record a conversion (beacon).
///
/// Fire-and-forget semantics: `200` means the row is durable (or a
/// deduped repeat — also fine). The Google Ads API upload happens in
/// the background and is retried by a later sweep; its outcome is
/// observable in the `ad_conversion` table's `status` column, never in
/// this response.
#[utoipa::path(
    post,
    path = "/api/ads/conversions",
    tag = "ads",
    request_body = ReportConversionRequest,
    responses(
        (status = 200, description = "Conversion recorded (or deduped)", body = ReportConversionResponse),
        (status = 400, description = "Invalid event / transaction id"),
    )
)]
pub async fn report_conversion(
    State(_st): State<AppState>,
    MaybeAuthUser(_user): MaybeAuthUser,
    Json(body): Json<ReportConversionRequest>,
) -> Result<Json<ReportConversionResponse>, AppError> {
    let event = body.event.trim().to_lowercase();
    if event.is_empty() || event.len() > 32 {
        return Err(AppError::BadRequest("event must be 1..=32 chars".into()));
    }
    // Absent transaction id → mint one (uuid): an id-less conversion
    // can't be deduped — mirroring Google's optional `orderId` — so
    // each fire records distinctly instead of collapsing.
    let transaction_id = body
        .transaction_id
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if transaction_id.len() > 128 {
        return Err(AppError::BadRequest(
            "transactionId must be 1..=128 chars".into(),
        ));
    }
    // The browser sends the value as a decimal string already; trim and
    // cap so a pathological beacon can't stuff megabytes into the row.
    let value = body
        .value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty() && v.len() <= 32)
        .map(str::to_string);
    let currency = body
        .currency
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty() && c.len() <= 8)
        .map(str::to_uppercase);

    let click_ids = body.click_ids;
    let ClickIds {
        gclid,
        wbraid,
        gbraid,
    } = click_ids;
    let outcome = crate::ads::ads()
        .record(NewAdConversion {
            event,
            transaction_id,
            conversion_value: value,
            currency,
            gclid: sanitize_click_id(gclid),
            wbraid: sanitize_click_id(wbraid),
            gbraid: sanitize_click_id(gbraid),
        })
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(ReportConversionResponse {
        ok: true,
        stored: outcome.stored,
        upload_attempted: outcome.upload_attempted,
        server_upload_enabled: crate::ads::ads().is_upload_enabled(),
    }))
}

/// Click ids are opaque tokens (typically ~100 chars); cap the stored
/// length so a hostile beacon can't bloat rows.
fn sanitize_click_id(id: Option<String>) -> Option<String> {
    id.map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() <= 1024)
}

/// Build the ads router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::post;
    axum::Router::new().route("/conversions", post(report_conversion))
}
