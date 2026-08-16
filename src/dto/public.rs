//! DTOs for the public catalog service — `/api/brands`, `/api/routes`,
//! `/api/trips/{id}`, `/api/search`, `/api/recommendations`,
//! `/api/campaigns`, `/api/campaigns/validate`, `/api/stats`.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

// ────────────────────────────────────────────────────────────────
//  Brands
// ────────────────────────────────────────────────────────────────

/// Slim brand entry returned by `GET /api/brands`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrandOut {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(rename = "accentColor", skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    #[serde(rename = "totalTrips")]
    pub total_trips: i64,
}

/// Brand detail returned by `GET /api/brands/{slug}`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrandDetailOut {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "contactPhone", skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
    #[serde(rename = "contactEmail", skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    #[serde(rename = "accentColor", skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
    #[serde(rename = "totalTrips")]
    pub total_trips: i64,
}

/// Response of `GET /api/brands`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BrandListResponse {
    pub items: Vec<BrandOut>,
}

// ────────────────────────────────────────────────────────────────
//  Routes
// ────────────────────────────────────────────────────────────────

/// A route list item returned by `GET /api/routes`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RouteOut {
    pub id: Uuid,
    #[serde(rename = "brandId", skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<String>,
    pub name: String,
    #[serde(rename = "distanceKm", skip_serializing_if = "Option::is_none")]
    pub distance_km: Option<f64>,
    #[serde(rename = "durationMin", skip_serializing_if = "Option::is_none")]
    pub duration_min: Option<i16>,
    pub brand: RouteBrandPreview,
    pub from: RouteEndpoint,
    pub to: RouteEndpoint,
    #[serde(rename = "scheduleCount")]
    pub schedule_count: usize,
}

/// Brand preview embedded in `RouteOut`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RouteBrandPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(rename = "accentColor", skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<f64>,
}

/// From/To endpoint embedded in `RouteOut`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RouteEndpoint {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

/// Response of `GET /api/routes`.
#[derive(Debug, Serialize, ToSchema)]
pub struct RouteListResponse {
    pub items: Vec<RouteOut>,
}

// ────────────────────────────────────────────────────────────────
//  Trip search + detail
// ────────────────────────────────────────────────────────────────

/// A trip search result returned by `GET /api/search` and
/// `GET /api/recommendations`.
#[derive(Debug, Serialize, ToSchema)]
pub struct TripResult {
    #[serde(rename = "tripId")]
    pub trip_id: Uuid,
    #[serde(rename = "scheduleId")]
    pub schedule_id: Uuid,
    #[serde(rename = "departureDate")]
    pub departure_date: String,
    pub status: String,
    #[serde(rename = "availableSeats")]
    pub available_seats: i64,
    #[serde(rename = "totalSeats")]
    pub total_seats: i64,
    #[serde(rename = "routeId")]
    pub route_id: Uuid,
    #[serde(rename = "routeName")]
    pub route_name: String,
    #[serde(rename = "distanceKm")]
    pub distance_km: f64,
    #[serde(rename = "durationMin")]
    pub duration_min: i16,
    #[serde(rename = "brandId", skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<String>,
    #[serde(rename = "brandName")]
    pub brand_name: String,
    #[serde(rename = "brandSlug")]
    pub brand_slug: String,
    #[serde(rename = "brandLogo", skip_serializing_if = "Option::is_none")]
    pub brand_logo: Option<String>,
    #[serde(rename = "brandRating")]
    pub brand_rating: f64,
    #[serde(rename = "brandAccent")]
    pub brand_accent: String,
    #[serde(rename = "fromName")]
    pub from_name: String,
    #[serde(rename = "fromLat")]
    pub from_lat: f64,
    #[serde(rename = "fromLon")]
    pub from_lon: f64,
    #[serde(rename = "toName")]
    pub to_name: String,
    #[serde(rename = "toLat")]
    pub to_lat: f64,
    #[serde(rename = "toLon")]
    pub to_lon: f64,
    #[serde(rename = "departureTime", skip_serializing_if = "Option::is_none")]
    pub departure_time: Option<String>,
    #[serde(rename = "departureAt", skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(rename = "arrivalAt", skip_serializing_if = "Option::is_none")]
    pub arrival_at: Option<String>,
    #[serde(rename = "busLayoutId", skip_serializing_if = "Option::is_none")]
    pub bus_layout_id: Option<String>,
    /// Adult ticket price (VND).
    #[serde(rename = "minPrice")]
    pub min_price: i64,
    /// Same as `min_price` for now (backend doesn't have a max price per trip).
    #[serde(rename = "maxPrice")]
    pub max_price: i64,
    #[serde(rename = "priceAdult")]
    pub price_adult: i64,
    #[serde(rename = "priceChild")]
    pub price_child: i64,
    #[serde(rename = "vehicleType")]
    pub vehicle_type: String,
    #[serde(rename = "vehicleTypeLabel")]
    pub vehicle_type_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity: Option<i16>,
    pub amenities: Vec<String>,
}

/// Response of `GET /api/search` and `GET /api/recommendations`.
#[derive(Debug, Serialize, ToSchema)]
pub struct TripSearchResponse {
    pub items: Vec<TripResult>,
}

// ── Trip detail ────────────────────────────────────────────────

/// Trip detail returned by `GET /api/trips/{id}`.
#[derive(Debug, Serialize, ToSchema)]
pub struct TripDetail {
    /// The trip + nested route + brand + bus layout + pickup points +
    /// seat map + campaigns, all in one response (frontend's
    /// TripDetailDialog consumes it).
    pub trip: TripCore,
    pub route: TripRouteDetail,
    pub brand: TripBrandDetail,
    pub from: TripEndpoint,
    pub to: TripEndpoint,
    #[serde(rename = "busLayout")]
    pub bus_layout: TripBusLayout,
    pub pricing: TripPricing,
    pub amenities: Vec<TripAmenity>,
    #[serde(rename = "pickupPoints")]
    pub pickup_points: Vec<TripPickupPoint>,
    #[serde(rename = "seatMap")]
    pub seat_map: TripSeatMap,
    pub campaigns: Vec<TripCampaign>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripCore {
    pub id: Uuid,
    #[serde(rename = "departureDate")]
    pub departure_date: String,
    #[serde(rename = "departureAt", skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(rename = "departureTime", skip_serializing_if = "Option::is_none")]
    pub departure_time: Option<String>,
    #[serde(rename = "arrivalAt", skip_serializing_if = "Option::is_none")]
    pub arrival_at: Option<String>,
    pub status: String,
    #[serde(rename = "driverName", skip_serializing_if = "Option::is_none")]
    pub driver_name: Option<String>,
    #[serde(rename = "totalSeats")]
    pub total_seats: i64,
    #[serde(rename = "availableSeats")]
    pub available_seats: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripRouteDetail {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "distanceKm")]
    pub distance_km: f64,
    #[serde(rename = "durationMin")]
    pub duration_min: Option<i16>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripBrandDetail {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    pub rating: f64,
    #[serde(rename = "accentColor", skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripEndpoint {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripBusLayout {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub capacity: Option<i16>,
    #[serde(rename = "vehicleType")]
    pub vehicle_type: String,
    #[serde(rename = "vehicleTypeLabel")]
    pub vehicle_type_label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripPricing {
    #[serde(rename = "basePriceAdult")]
    pub base_price_adult: i64,
    #[serde(rename = "basePriceChild")]
    pub base_price_child: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripAmenity {
    pub key: String,
    pub label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripPickupPoint {
    pub id: Uuid,
    pub name: Option<String>,
    #[serde(rename = "stopOrder", skip_serializing_if = "Option::is_none")]
    pub stop_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(rename = "pickupType", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripSeatMap {
    pub decks: Vec<TripSeatDeck>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripSeatDeck {
    pub deck: i16,
    pub rows: Vec<TripSeatRow>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripSeatRow {
    pub row: i16,
    pub seats: Vec<TripSeat>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripSeat {
    pub id: Uuid,
    pub code: String,
    #[serde(rename = "seatLabel")]
    pub seat_label: String,
    pub row: i16,
    pub col: i16,
    pub deck: i16,
    #[serde(rename = "seatClass", skip_serializing_if = "Option::is_none")]
    pub seat_class: Option<String>,
    pub status: String,
    #[serde(rename = "finalPrice")]
    pub final_price: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TripCampaign {
    pub id: Uuid,
    pub code: String,
    #[serde(rename = "discountType")]
    pub discount_type: String,
    #[serde(rename = "discountValue")]
    pub discount_value: i64,
    #[serde(rename = "maxUses", skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<i64>,
    #[serde(rename = "usedCount")]
    pub used_count: i64,
    #[serde(rename = "startsAt", skip_serializing_if = "Option::is_none")]
    pub starts_at: Option<String>,
    #[serde(rename = "endsAt", skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<String>,
    pub status: String,
}

// ────────────────────────────────────────────────────────────────
//  Campaigns
// ────────────────────────────────────────────────────────────────

/// Campaign list item returned by `GET /api/campaigns`.
#[derive(Debug, Serialize, ToSchema)]
pub struct CampaignOut {
    pub id: Uuid,
    pub code: String,
    #[serde(rename = "discountType")]
    pub discount_type: String,
    #[serde(rename = "discountValue")]
    pub discount_value: i64,
    #[serde(rename = "endsAt", skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<String>,
}

/// Response of `GET /api/campaigns`.
#[derive(Debug, Serialize, ToSchema)]
pub struct CampaignListResponse {
    pub items: Vec<CampaignOut>,
}

/// Response of `GET /api/campaigns/validate?code=&subtotal=`.
#[derive(Debug, Serialize, ToSchema)]
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
pub struct SearchTripsQuery {
    pub from: String,
    pub to: String,
    pub date: String,
    pub limit: Option<u64>,
    #[serde(rename = "vehicle_types")]
    pub vehicle_types: Option<String>,
    pub sort: Option<String>,
    #[serde(rename = "min_seats")]
    pub min_seats: Option<i64>,
}
