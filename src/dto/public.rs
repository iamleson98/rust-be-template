//! DTOs for the public catalog service — `/api/brands`, `/api/routes`,
//! `/api/trips/{id}`, `/api/search`, `/api/recommendations`,
//! `/api/campaigns`, `/api/campaigns/validate`, `/api/stats`.
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` so Rust field names
//! stay snake_case (Rust convention) while the JSON wire shape is
//! camelCase (JSON/TypeScript convention).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::dto::seat_plan::{CellKind, PlanCell};

// ────────────────────────────────────────────────────────────────
//  Brands
// ────────────────────────────────────────────────────────────────

/// Slim brand entry returned by `GET /api/brands`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrandOut {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    pub total_trips: i64,
}

/// Brand detail returned by `GET /api/brands/{slug}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrandDetailOut {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    pub total_trips: i64,
}

/// Response of `GET /api/brands`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrandListResponse {
    pub items: Vec<BrandOut>,
}

// ────────────────────────────────────────────────────────────────
//  Routes
// ────────────────────────────────────────────────────────────────

/// A route list item returned by `GET /api/routes`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RouteOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    pub name: String,
    pub brand: RouteBrandPreview,
    pub from: RouteEndpoint,
    pub to: RouteEndpoint,
    pub schedule_count: usize,
    /// Lowest adult base price across the route's schedules (VND).
    /// `None` when the route has no schedules yet — the frontend must
    /// NOT invent a price in that case.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price_from: Option<i64>,
}

/// Brand preview embedded in `RouteOut`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RouteBrandPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
}

/// From/To endpoint embedded in `RouteOut`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RouteEndpoint {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

/// Response of `GET /api/routes`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RouteListResponse {
    pub items: Vec<RouteOut>,
}

// ────────────────────────────────────────────────────────────────
//  Trip search + detail
// ────────────────────────────────────────────────────────────────

/// A trip search result returned by `GET /api/search` and
/// `GET /api/recommendations`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripResult {
    pub trip_id: Uuid,
    pub schedule_id: Uuid,
    pub departure_date: String,
    pub status: String,
    pub available_seats: i64,
    pub total_seats: i64,
    pub route_id: Uuid,
    pub route_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    pub brand_name: String,
    pub brand_slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_logo: Option<String>,
    pub brand_rating: f64,
    pub brand_accent: String,
    pub from_name: String,
    pub from_lat: f64,
    pub from_lon: f64,
    pub to_name: String,
    pub to_lat: f64,
    pub to_lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bus_layout_id: Option<String>,
    /// Adult ticket price (VND).
    pub min_price: i64,
    /// Same as `min_price` for now (backend doesn't have a max price per trip).
    pub max_price: i64,
    pub price_adult: i64,
    pub price_child: i64,
    pub vehicle_type: String,
    pub vehicle_type_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity: Option<i16>,
    pub amenities: Vec<String>,
}

/// Response of `GET /api/search`, `GET /api/search/geo` and `GET /api/recommendations`. The search endpoints are paginated; `/api/recommendations` omits the page metadata.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripSearchResponse {
    pub items: Vec<TripResult>,
    /// Total matching trips across ALL pages (before the offset window is applied). Omitted on non-paginated responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    /// Page size the server actually applied (after clamping). Omitted on non-paginated responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    /// Index of the first item inside this page. Omitted on non-paginated responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
    /// True when more matching trips exist past this page — the signal for the frontend's "load more" button. Omitted on non-paginated responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
}

impl TripSearchResponse {
    /// Single-shot (non-paginated) response — the legacy shape with no
    /// page metadata, used by `/api/recommendations` and other internal
    /// callers that return a fixed small set.
    pub fn unpaginated(items: Vec<TripResult>) -> Self {
        Self {
            items,
            total: None,
            limit: None,
            offset: None,
            has_more: None,
        }
    }

    /// Paginated response. `total` is the pre-slice match count;
    /// `has_more` is derived from it so consumers never need to infer.
    pub fn paged(items: Vec<TripResult>, total: u64, limit: u64, offset: u64) -> Self {
        let has_more = offset.saturating_add(items.len() as u64) < total;
        Self {
            items,
            total: Some(total),
            limit: Some(limit),
            offset: Some(offset),
            has_more: Some(has_more),
        }
    }

    /// Paginated EMPTY response — early returns (no matching routes, no
    /// trips on the date, …) still carry the page metadata so clients
    /// can trust `hasMore: false` instead of guessing from `[]`.
    pub fn paged_empty(limit: u64, offset: u64) -> Self {
        Self::paged(Vec::new(), 0, limit, offset)
    }
}

// ── Trip detail ────────────────────────────────────────────────

/// Trip detail returned by `GET /api/trips/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripDetail {
    /// The trip + nested route + brand + bus layout + pickup points +
    /// seat map + campaigns, all in one response (frontend's
    /// TripDetailDialog consumes it).
    pub trip: TripCore,
    pub route: TripRouteDetail,
    pub brand: TripBrandDetail,
    pub from: TripEndpoint,
    pub to: TripEndpoint,
    pub bus_layout: TripBusLayout,
    pub pricing: TripPricing,
    pub amenities: Vec<TripAmenity>,
    pub pickup_points: Vec<TripPickupPoint>,
    /// The schedule's ordered stops WITH arrival times — the real
    /// per-stop timetable from the `schedule_point` table (what the
    /// admin configured). Empty when the schedule has no points; the
    /// frontend falls back to the route-level `pickup_points`.
    pub schedule_points: Vec<TripSchedulePoint>,
    pub seat_map: TripSeatMap,
    pub campaigns: Vec<TripCampaign>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripCore {
    pub id: Uuid,
    pub departure_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_at: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub driver_name: Option<String>,
    pub total_seats: i64,
    pub available_seats: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripRouteDetail {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripBrandDetail {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    pub rating: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripEndpoint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripBusLayout {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub capacity: Option<i16>,
    pub vehicle_type: String,
    pub vehicle_type_label: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripPricing {
    pub base_price_adult: i64,
    pub base_price_child: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripAmenity {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripPickupPoint {
    pub id: Uuid,
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
}

/// One ordered stop of a schedule's timetable (`schedule_point` joined
/// with `address`). Unlike `TripPickupPoint` (route-level, no times),
/// these carry the `arrival_time` the admin configured per stop —
/// the source of truth for the trip's schedule timeline.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripSchedulePoint {
    pub id: Uuid,
    pub stop_order: i64,
    /// `pickup` (first) / `middle` / `drop` (last) — derived from the
    /// point's position when the admin upserts the schedule.
    pub kind: String,
    /// Optional `HH:MM` — when the vehicle reaches this stop.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_time: Option<String>,
    /// Address (stop place) display name.
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripSeatMap {
    pub decks: Vec<TripSeatDeck>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripSeatDeck {
    pub deck: i16,
    /// Physical grid of the deck. Absent for layouts that predate seat
    /// plans — clients then infer a grid from the seats' row/col.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<TripDeckPlan>,
    pub rows: Vec<TripSeatRow>,
}

/// The drawable frame of one deck: grid size plus the non-sellable
/// fixtures (driver, door, stairs, WC). Seats are placed by their own
/// `row`/`col`; every other cell is an aisle or gap.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripDeckPlan {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub rows: i16,
    pub cols: i16,
    pub fixtures: Vec<PlanCell>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripSeatRow {
    pub row: i16,
    pub seats: Vec<TripSeat>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripSeat {
    pub id: Uuid,
    pub code: String,
    pub seat_label: String,
    pub row: i16,
    pub col: i16,
    pub deck: i16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_class: Option<String>,
    /// What the seat physically is (`seat`, `bed`, `cabin`, …). Absent
    /// for layouts that predate seat plans.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<CellKind>,
    pub status: String,
    pub final_price: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TripCampaign {
    pub id: Uuid,
    pub code: String,
    pub discount_type: String,
    pub discount_value: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<i64>,
    pub used_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starts_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<String>,
    pub status: String,
}

// ────────────────────────────────────────────────────────────────
//  Campaigns
// ────────────────────────────────────────────────────────────────

/// Campaign list item returned by `GET /api/campaigns`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignOut {
    pub id: Uuid,
    pub code: String,
    pub discount_type: String,
    pub discount_value: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<String>,
}

/// Response of `GET /api/campaigns`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignListResponse {
    pub items: Vec<CampaignOut>,
}

/// Response of `GET /api/campaigns/validate?code=&subtotal=`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CampaignValidateResponse {
    pub valid: bool,
    /// Discount amount (VND) applied to the subtotal. 0 when invalid.
    pub discount: i64,
}

// ────────────────────────────────────────────────────────────────
//  Stats
// ────────────────────────────────────────────────────────────────

/// Public homepage stats returned by `GET /api/stats`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StatsResponse {
    pub brands: u64,
    pub routes: u64,
    pub trips: u64,
}

// ────────────────────────────────────────────────────────────────
//  Query params (declared here so the OpenAPI `params(...)` can
//  reference them)
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct SearchTripsQuery {
    pub from: String,
    pub to: String,
    pub date: String,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub vehicle_types: Option<String>,
    pub sort: Option<String>,
    pub min_seats: Option<i64>,
}
