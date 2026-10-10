//! Discount campaigns and coupons (see `docs/CAMPAIGNS.md`).

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

// ────────────────────────────────────────────────────────────────
//  Public + customer
// ────────────────────────────────────────────────────────────────

/// An operator a campaign covers.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignBrandOut {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
}

/// One "amount × slots" voucher of a campaign.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignTierOut {
    pub id: Uuid,
    /// The discount, in VND.
    pub amount: i64,
    pub total_slots: i64,
    /// Slots still free (from the cache: claims keep it current, claiming
    /// itself is exact).
    pub remaining: i64,
}

/// A campaign as the home page shows it.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicCampaignOut {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// ISO-8601 UTC.
    pub starts_at: String,
    /// ISO-8601 UTC.
    pub ends_at: String,
    /// `campaign` (book before `endsAt`) or `permanent`.
    pub coupon_validity: String,
    pub all_brands: bool,
    /// The covered operators (empty when `allBrands`).
    pub brands: Vec<CampaignBrandOut>,
    /// Biggest discount first.
    pub tiers: Vec<CampaignTierOut>,
}

/// Response of `GET /api/campaigns`: running and upcoming campaigns.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicCampaignListResponse {
    pub items: Vec<PublicCampaignOut>,
    /// The server's clock (ISO-8601 UTC), for countdowns that do not
    /// trust the device clock.
    pub server_time: String,
}

/// A customer's coupon.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CouponOut {
    pub id: Uuid,
    pub code: String,
    pub campaign_id: Uuid,
    pub campaign_name: String,
    /// The discount, in VND.
    pub amount: i64,
    /// `held` (ready to use) or `reserved` (on a booking that has not
    /// travelled yet).
    pub status: String,
    /// Book before this (ISO-8601 UTC); absent = no end.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_until: Option<String>,
    pub all_brands: bool,
    pub brands: Vec<CampaignBrandOut>,
    /// The booking it is on, while `reserved`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub booking_code: Option<String>,
    pub claimed_at: String,
}

/// Response of `GET /api/coupons/mine`.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MyCouponsResponse {
    /// The coupon the account holds; at most one at a time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<CouponOut>,
    /// Campaigns this account already claimed from (one coupon each).
    pub claimed_campaign_ids: Vec<Uuid>,
}

// ────────────────────────────────────────────────────────────────
//  Admin
// ────────────────────────────────────────────────────────────────

/// A tier in a create/update request. `id` names an existing tier.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TierInput {
    #[serde(default)]
    pub id: Option<Uuid>,
    /// VND, a positive multiple of 1 000.
    pub amount: i64,
    pub total_slots: i64,
}

/// The whole campaign as the admin wants it (create, or replace on
/// update). Tiers missing from an update are removed (allowed only while
/// nobody claimed them).
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// ISO-8601 (any offset; stored in UTC).
    pub starts_at: String,
    /// ISO-8601 (any offset; stored in UTC).
    pub ends_at: String,
    /// `campaign` or `permanent`.
    pub coupon_validity: String,
    pub all_brands: bool,
    /// Required (non-empty) when `allBrands` is false.
    #[serde(default)]
    pub brand_ids: Vec<Uuid>,
    pub tiers: Vec<TierInput>,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminTierOut {
    pub id: Uuid,
    pub amount: i64,
    pub total_slots: i64,
    pub claimed_slots: i64,
}

/// Where a campaign's money stands.
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignTotalsOut {
    /// Σ amount × slots over its tiers (VND): the most it can cost.
    pub budget: i64,
    /// Coupons handed out (not given back).
    pub claimed: i64,
    /// Coupons on bookings that have not travelled yet.
    pub in_use: i64,
    /// Trips taken: payouts awaiting an admin (count and VND).
    pub owed_count: i64,
    pub owed_amount: i64,
    /// Payouts made (count and VND).
    pub paid_count: i64,
    pub paid_amount: i64,
    pub rejected_count: i64,
    pub expired_count: i64,
}

/// A campaign in the admin console.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminCampaignOut {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub starts_at: String,
    pub ends_at: String,
    pub coupon_validity: String,
    pub all_brands: bool,
    pub brands: Vec<CampaignBrandOut>,
    pub paused: bool,
    /// `upcoming`, `running`, `paused` or `ended`.
    pub state: String,
    pub tiers: Vec<AdminTierOut>,
    pub totals: CampaignTotalsOut,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminCampaignListResponse {
    pub items: Vec<AdminCampaignOut>,
}

/// Filters of `GET /api/admin/coupons`.
#[derive(Debug, Clone, Default, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminCouponQuery {
    pub campaign_id: Option<Uuid>,
    pub brand_id: Option<Uuid>,
    /// Comma-separated statuses (e.g. `redeemed` for payouts to review).
    pub status: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CouponOwnerOut {
    pub id: Uuid,
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CouponBookingOut {
    pub id: Uuid,
    pub code: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
}

/// A coupon in the admin console, with what an admin should look at
/// before paying it out.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminCouponOut {
    pub id: Uuid,
    pub code: String,
    pub campaign_id: Uuid,
    pub campaign_name: String,
    pub amount: i64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<CouponOwnerOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub booking: Option<CouponBookingOut>,
    /// The operator to pay.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand: Option<CampaignBrandOut>,
    pub claimed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redeemed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settled_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settlement_note: Option<String>,
    /// Other coupons of this campaign used with the same contact phone.
    pub shared_phone: i64,
    /// Other coupons of this campaign claimed from the same network.
    pub shared_ip: i64,
    /// The account was created less than a day before it claimed.
    pub new_account: bool,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminCouponListResponse {
    pub items: Vec<AdminCouponOut>,
    pub total: u64,
}

/// Body of `POST /api/admin/coupons/settle`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettleCouponsRequest {
    pub coupon_ids: Vec<Uuid>,
    /// Payment reference or note.
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettleCouponsResponse {
    /// How many were redeemed and are now paid (others were skipped).
    pub settled: u64,
}

/// Body of `POST /api/admin/coupons/{id}/reject`.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RejectCouponRequest {
    pub reason: String,
}

/// What the platform owes and paid one operator.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayoutOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand: Option<CampaignBrandOut>,
    pub owed_count: i64,
    pub owed_amount: i64,
    pub paid_count: i64,
    pub paid_amount: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PayoutListResponse {
    /// Most owed first.
    pub items: Vec<PayoutOut>,
    pub total_owed: i64,
    pub total_paid: i64,
}
