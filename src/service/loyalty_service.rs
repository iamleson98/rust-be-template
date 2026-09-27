//! Loyalty service — real, booking-derived loyalty state.
//!
//! The loyalty balance is COMPUTED, never stored: the user's completed
//! bookings are the earning ledger (`1 point per 10,000 VND` of each
//! booking total, floored per booking), and the tier is a threshold
//! band over that balance. This keeps loyalty automatically consistent
//! with booking data — no separate points table to drift out of sync,
//! no client-side "point wallet" to fake.
//!
//! Tier thresholds + benefit codes are backend-owned constants (the
//! frontend renders them, it never invents them):
//!
//!   * bronze    0 – 999        earn_points, redeem_voucher
//!   * silver    1,000 – 4,999  discount_5, voucher_25k
//!   * gold      5,000 – 19,999 discount_10, priority_seat, voucher_60k
//!   * platinum  20,000+        discount_15, priority_seat, free_refund,
//!     voucher_150k
//!
//! History entries resolve route/brand names via the same
//! `booking → trip_session → schedule → route → brand` chain the
//! booking list uses, batched (4 lookups total, no N+1).

use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use crate::dto::loyalty::{LoyaltyHistoryEntry, LoyaltyResponse, LoyaltyTierOut};
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

/// Points earn rate: 1 point per 10,000 VND of booking total.
const POINT_RATE_VND: i64 = 10_000;

/// History is capped at the 20 most-recent earning events — enough for
/// the loyalty panel without materializing a lifetime of rows.
const HISTORY_LIMIT: u64 = 20;

/// Completed-bookings scan bound (defensive; a user reaching this many
/// completed bookings has far bigger loyalty problems than truncation).
const SCAN_LIMIT: u64 = 500;

/// Tier table, ascending by `min_points`. The last tier is unbounded.
const TIERS: &[(&str, &str, i64, &[&str])] = &[
    ("bronze", "Bronze", 0, &["earn_points", "redeem_voucher"]),
    ("silver", "Silver", 1_000, &["discount_5", "voucher_25k"]),
    (
        "gold",
        "Gold",
        5_000,
        &["discount_10", "priority_seat", "voucher_60k"],
    ),
    (
        "platinum",
        "Platinum",
        20_000,
        &[
            "discount_15",
            "priority_seat",
            "free_refund",
            "voucher_150k",
        ],
    ),
];

fn tier_out(idx: usize) -> LoyaltyTierOut {
    let (key, name, min, codes) = TIERS[idx];
    LoyaltyTierOut {
        key: (*key).to_string(),
        name: (*name).to_string(),
        min_points: min,
        benefit_codes: codes.iter().map(|c| c.to_string()).collect(),
    }
}

fn resolve_tier(points: i64) -> usize {
    // Ascending scan — the last tier whose min_points <= points wins.
    let mut idx = 0;
    for (i, (_, _, min, _)) in TIERS.iter().enumerate() {
        if points >= *min {
            idx = i;
        }
    }
    idx
}

pub struct LoyaltyService {
    store: Arc<CompositeStore>,
}

impl LoyaltyService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// The authenticated user's loyalty summary (points, tier, history).
    pub async fn summary(&self, user_id: Uuid) -> AppResult<LoyaltyResponse> {
        let uid = user_id.to_string();

        // Completed bookings only — pending/cancelled trips never earn.
        // No departure-date filter: a completed booking stays earned.
        let bookings = self
            .store
            .booking_store()
            .list_bookings_by_user_with_date_filter(&uid, "completed", None, None, SCAN_LIMIT, 0)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // ── Aggregate the balance ───────────────────────────────────
        let mut points: i64 = 0;
        let mut total_spent: i64 = 0;
        for b in &bookings {
            points += b.total / POINT_RATE_VND;
            total_spent += b.total;
        }
        let currency = bookings
            .first()
            .map(|b| b.currency.clone())
            .unwrap_or_else(|| "VND".into());

        // ── Tier band ───────────────────────────────────────────────
        let idx = resolve_tier(points);
        let tier = tier_out(idx);
        let next_tier = if idx + 1 < TIERS.len() {
            Some(tier_out(idx + 1))
        } else {
            None
        };

        // ── History (most-recent first; the store orders by created_at desc) ──
        let history = self
            .build_history(&bookings, HISTORY_LIMIT as usize)
            .await?;

        Ok(LoyaltyResponse {
            points,
            completed_trips: bookings.len() as i64,
            total_spent,
            currency,
            tier,
            next_tier,
            history,
        })
    }

    /// Resolve route/brand names for the newest `limit` bookings via
    /// batched lookups: trips → schedules → routes → brands.
    async fn build_history(
        &self,
        bookings: &[crate::entity::booking::Model],
        limit: usize,
    ) -> AppResult<Vec<LoyaltyHistoryEntry>> {
        let newest: Vec<&crate::entity::booking::Model> = bookings.iter().take(limit).collect();
        if newest.is_empty() {
            return Ok(Vec::new());
        }

        // booking → trip_session
        let trip_ids: Vec<Uuid> = newest.iter().map(|b| b.trip_session_id).collect();
        let trips: HashMap<String, crate::entity::trip_session::Model> = self
            .store
            .trip_store()
            .list_trips_by_ids(trip_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|t| (t.id.to_string(), t))
            .collect();

        // trip_session → schedule
        let schedule_ids: Vec<Uuid> = trips.values().map(|t| t.schedule_id).collect();
        let schedules: HashMap<String, crate::entity::schedule::Model> = self
            .store
            .schedule_store()
            .list_schedules_by_ids(schedule_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|s| (s.id.to_string(), s))
            .collect();

        // schedule → route
        let route_ids: Vec<Uuid> = schedules.values().map(|s| s.route_id).collect();
        let routes: HashMap<String, crate::entity::route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(route_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|r| (r.id.to_string(), r))
            .collect();

        // route → brand
        let brand_ids: Vec<Uuid> = routes.values().filter_map(|r| r.brand_id).collect();
        let brands: HashMap<String, crate::entity::brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(brand_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id.to_string(), b))
            .collect();

        let entries = newest
            .iter()
            .map(|b| {
                let trip = trips.get(&b.trip_session_id.to_string());
                let schedule = trip.and_then(|t| schedules.get(&t.schedule_id.to_string()));
                let route = schedule.and_then(|s| routes.get(&s.route_id.to_string()));
                let brand = route
                    .and_then(|r| r.brand_id)
                    .and_then(|bid| brands.get(&bid.to_string()));

                // Departure: actual first, scheduled as fallback (same
                // rule as the booking list preview).
                let departure_at = trip.and_then(|t| {
                    t.actual_departure_at.clone().or_else(|| {
                        schedule.map(|s| format!("{}T{}", t.departure_date, s.departure_time))
                    })
                });

                LoyaltyHistoryEntry {
                    booking_id: b.id,
                    booking_code: b.code.clone(),
                    route_name: route.map(|r| r.name.clone()),
                    brand_name: brand.map(|br| br.name.clone()),
                    departure_at,
                    total: b.total,
                    currency: b.currency.clone(),
                    points: b.total / POINT_RATE_VND,
                }
            })
            .collect();
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_bands_are_ascending_and_exhaustive() {
        for w in TIERS.windows(2) {
            assert!(w[0].2 < w[1].2, "tier thresholds must be ascending");
        }
        assert_eq!(TIERS[0].2, 0, "lowest tier starts at 0 points");
    }

    #[test]
    fn resolve_tier_matches_bands() {
        assert_eq!(resolve_tier(0), 0);
        assert_eq!(resolve_tier(999), 0);
        assert_eq!(resolve_tier(1_000), 1);
        assert_eq!(resolve_tier(4_999), 1);
        assert_eq!(resolve_tier(5_000), 2);
        assert_eq!(resolve_tier(19_999), 2);
        assert_eq!(resolve_tier(20_000), 3);
        assert_eq!(resolve_tier(999_999), 3);
    }

    #[test]
    fn top_tier_has_no_next() {
        let idx = resolve_tier(1_000_000);
        assert!(idx + 1 >= TIERS.len());
    }
}
