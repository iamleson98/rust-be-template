//! Ads routes — `POST /api/ads/conversions` (server-side conversion
//! recording for Google Ads).
//!
//! The SPA calls this from `trackConversion()` (see
//! `frontend/src/lib/analytics.ts`) via `navigator.sendBeacon` at the
//! money moment, forwarding the click ids captured on landing. The
//! hub (`crate::ads`) verifies it against the booking, persists the
//! record (deduped) and, when the `GOOGLE_ADS_*` credential group is
//! configured, uploads it to the Google Ads API asynchronously —
//! measurement never blocks the flow.
//!
//! Auth note: `MaybeAuthUser`, deliberately. The beacon rides on the
//! booking/payment session, which can expire in the seconds between
//! the money moment and the beacon — a measurement record carrying
//! zero PII (event, booking code, click ids) must not be lost to that.

use axum::Json;

use crate::dto::ad_conversion::{ReportConversionRequest, ReportConversionResponse};
use crate::error::AppError;
use crate::middleware::MaybeAuthUser;

/// `POST /api/ads/conversions` — record a conversion (beacon).
///
/// Fire-and-forget semantics: `200` means the row is durable (or a
/// deduped repeat — also fine). The Google Ads API upload happens in
/// the background and is retried by a later sweep; its outcome is
/// observable in the `ad_conversion` table's `status` column, never in
/// this response.
///
/// The beacon is trusted for nothing but the click ids: the event must
/// be `booking` or `purchase`, `transactionId` a real booking's code, and
/// value and currency come from the database (see
/// [`AdsHub::report`](crate::ads::AdsHub::report)).
#[utoipa::path(
    post,
    path = "/api/ads/conversions",
    tag = "ads",
    request_body = ReportConversionRequest,
    responses(
        (status = 200, description = "Conversion recorded (or deduped)", body = ReportConversionResponse),
        (status = 400, description = "Unknown event or missing transaction id"),
        (status = 404, description = "No such booking, or a purchase with no completed payment"),
    )
)]
pub async fn report_conversion(
    MaybeAuthUser(_user): MaybeAuthUser,
    Json(body): Json<ReportConversionRequest>,
) -> Result<Json<ReportConversionResponse>, AppError> {
    Ok(Json(crate::ads::ads().report(body).await?))
}

/// Build the ads router.
pub fn router() -> axum::Router<crate::state::AppState> {
    use axum::routing::post;
    axum::Router::new().route("/conversions", post(report_conversion))
}
