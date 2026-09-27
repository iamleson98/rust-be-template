//! DTOs for the loyalty service (`GET /api/loyalty`).
//!
//! Loyalty is fully derived from REAL booking data: points are earned
//! from the user's completed bookings (1 point per 10,000 VND of the
//! booking total), tiers are threshold bands over the point balance,
//! and the history is the per-booking earning ledger. Nothing is
//! stored or invented client-side — the backend is the single source
//! of truth.
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` for wire-shape
//! consistency with the rest of the API.

use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

/// A loyalty tier band (returned by `GET /api/loyalty`).
///
/// `name` is a proper noun (Platinum / Gold / Silver / Bronze) and is
/// intentionally NOT translated. `benefit_codes` are language-neutral
/// codes the frontend maps onto its i18n dictionary — the tier→benefit
/// mapping itself is backend-owned data.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoyaltyTierOut {
    /// Tier key: `bronze` | `silver` | `gold` | `platinum`.
    pub key: String,
    /// Tier display name (proper noun, untranslated).
    pub name: String,
    /// Minimum point balance for this tier (inclusive lower bound).
    pub min_points: i64,
    /// Benefit codes attached to this tier (language-neutral).
    pub benefit_codes: Vec<String>,
}

/// One completed booking that earned points (history entry).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoyaltyHistoryEntry {
    pub booking_id: Uuid,
    pub booking_code: String,
    /// Route name (e.g. "Hà Nội → Đà Nẵng"), when resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_name: Option<String>,
    /// Brand name of the operated trip, when resolvable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    /// Departure timestamp (actual, or scheduled as fallback).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    /// Booking total in the booking's currency (points base).
    pub total: i64,
    pub currency: String,
    /// Points earned by this booking (`total / 10_000`, floored).
    pub points: i64,
}

/// Response of `GET /api/loyalty`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoyaltyResponse {
    /// Current point balance (sum of all earned points).
    pub points: i64,
    /// Number of completed bookings behind the balance.
    pub completed_trips: i64,
    /// Sum of the completed bookings' totals (points base).
    pub total_spent: i64,
    /// Currency of the underlying bookings (all bookings are VND).
    pub currency: String,
    /// The tier the current point balance falls into.
    pub tier: LoyaltyTierOut,
    /// The next tier up (None when already at the top tier).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_tier: Option<LoyaltyTierOut>,
    /// Most-recent earning events (completed bookings, newest first).
    pub history: Vec<LoyaltyHistoryEntry>,
}
