//! DTOs for the booking service (`/api/bookings`, `/api/bookings/hold`,
//! `/api/bookings/{id}`, `/api/bookings/{id}/cancel`, `/api/bookings/{id}/confirm`).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

// ────────────────────────────────────────────────────────────────
//  Request DTOs (kept here so the OpenAPI spec can reference them)
// ────────────────────────────────────────────────────────────────

/// One passenger on a booking.
#[derive(Debug, Deserialize, Clone, ToSchema)]
pub struct PassengerReq {
    pub name: String,
    #[serde(rename = "type")]
    pub passenger_type: String,
    #[serde(default)]
    pub age: i64,
}

/// Request body for `POST /api/bookings` and `POST /api/bookings/hold`.
#[derive(Debug, Deserialize, Clone, ToSchema)]
pub struct HoldReq {
    #[serde(rename = "trip_id")]
    pub trip_id: String,
    #[serde(rename = "seat_ids")]
    pub seat_ids: Vec<String>,
    pub passengers: Vec<PassengerReq>,
    #[serde(rename = "boarding_point_id")]
    pub boarding_point_id: String,
    #[serde(rename = "dropping_point_id")]
    pub dropping_point_id: String,
    #[serde(rename = "contact_name")]
    pub contact_name: String,
    #[serde(rename = "contact_phone")]
    pub contact_phone: String,
    #[serde(rename = "contact_email", default)]
    pub contact_email: Option<String>,
    #[serde(rename = "campaign_code", default)]
    pub campaign_code: Option<String>,
}

/// Request body for `POST /api/bookings/:id/confirm`.
#[derive(Debug, Deserialize, Clone, ToSchema)]
pub struct ConfirmReq {
    #[serde(default = "default_payment", rename = "payment_method")]
    pub payment_method: String,
}

fn default_payment() -> String {
    "momo".into()
}

/// Request body for `POST /api/bookings/:id/cancel`.
#[derive(Debug, Deserialize, Clone, ToSchema)]
pub struct CancelReq {
    #[serde(default, rename = "reason")]
    pub reason: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Response DTOs
// ────────────────────────────────────────────────────────────────

/// A held seat inside a booking response.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingSeatOut {
    #[serde(rename = "seatId", skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
    #[serde(rename = "seatCode", skip_serializing_if = "Option::is_none")]
    pub seat_code: Option<String>,
    #[serde(rename = "seatClass", skip_serializing_if = "Option::is_none")]
    pub seat_class: Option<String>,
    #[serde(rename = "passengerName", skip_serializing_if = "Option::is_none")]
    pub passenger_name: Option<String>,
    #[serde(rename = "passengerType", skip_serializing_if = "Option::is_none")]
    pub passenger_type: Option<String>,
    #[serde(rename = "passengerAge", skip_serializing_if = "Option::is_none")]
    pub passenger_age: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<i64>,
}

/// Slim trip preview embedded in `BookingListItem`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingTripPreview {
    pub id: Uuid,
    #[serde(rename = "departureAt", skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(rename = "departureDate", skip_serializing_if = "Option::is_none")]
    pub departure_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(rename = "routeName", skip_serializing_if = "Option::is_none")]
    pub route_name: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(rename = "brandName", skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(rename = "brandAccent", skip_serializing_if = "Option::is_none")]
    pub brand_accent: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(rename = "brandLogo", skip_serializing_if = "Option::is_none")]
    pub brand_logo: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(rename = "vehicleType", skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<String>,
    /// Present on the detail payload (not the list payload).
    pub route: Option<BookingRoutePreview>,
    /// Present on the detail payload (not the list payload).
    #[serde(rename = "busLayout", skip_serializing_if = "Option::is_none")]
    pub bus_layout: Option<BookingBusLayoutPreview>,
    /// Present on the detail payload (not the list payload).
    #[serde(
        rename = "pickupPoints",
        skip_serializing_if = "Vec::is_empty",
        default
    )]
    pub pickup_points: Vec<PickupPointOut>,
}

/// Route preview embedded in `BookingTripPreview`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingRoutePreview {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(rename = "distanceKm", skip_serializing_if = "Option::is_none")]
    pub distance_km: Option<f64>,
    #[serde(rename = "durationMin", skip_serializing_if = "Option::is_none")]
    pub duration_min: Option<i16>,
    pub brand: BookingBrandPreview,
}

/// Brand preview embedded in `BookingRoutePreview`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingBrandPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "accentColor", skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(rename = "logoUrl", skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
}

/// Bus layout preview embedded in `BookingTripPreview`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingBusLayoutPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "vehicleType", skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<String>,
}

/// Pickup point embedded in `BookingTripPreview.pickup_points`.
#[derive(Debug, Serialize, ToSchema)]
pub struct PickupPointOut {
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

/// Response of `GET /api/bookings` (list item) and `GET /api/bookings/{id}`
/// (detail — same shape, just with the full trip preview filled in).
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingListItem {
    pub id: Uuid,
    pub code: String,
    pub status: String,
    #[serde(rename = "adultCount", skip_serializing_if = "Option::is_none")]
    pub adult_count: Option<i64>,
    #[serde(rename = "childCount", skip_serializing_if = "Option::is_none")]
    pub child_count: Option<i64>,
    pub subtotal: i64,
    pub discount: i64,
    pub fees: i64,
    pub total: i64,
    pub currency: String,
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt", skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(rename = "contactName", skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
    #[serde(rename = "contactPhone", skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
    #[serde(rename = "contactEmail", skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    /// Present on the list-with-detail shape (`include_boarding_dropping_ids=true`).
    #[serde(rename = "boardingPointId", skip_serializing_if = "Option::is_none")]
    pub boarding_point_id: Option<String>,
    /// Present on the list-with-detail shape.
    #[serde(rename = "droppingPointId", skip_serializing_if = "Option::is_none")]
    pub dropping_point_id: Option<String>,
    #[serde(rename = "paymentMethod", skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    /// Timestamp when the booking was paid (`updated_at` snapshot at status=confirmed).
    #[serde(rename = "paidAt", skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<String>,
    pub seats: Vec<BookingSeatOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trip: Option<BookingTripPreview>,
}

/// Response of `GET /api/bookings`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingListResponse {
    pub items: Vec<BookingListItem>,
    pub total: usize,
}

/// Response of `GET /api/bookings/lookup`. Same shape as the list, but
/// without the `total` field (the lookup endpoint doesn't paginate).
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingLookupResponse {
    pub items: Vec<BookingListItem>,
}

/// Response of `GET /api/bookings/{id}`. Carries the full enriched
/// detail (seats + trip + route + brand + pickup points + bus layout).
pub type BookingDetailResponse = BookingListItem;

/// Response of `POST /api/bookings` and `POST /api/bookings/hold`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingHoldResponse {
    #[serde(rename = "bookingId")]
    pub booking_id: Uuid,
    pub code: String,
    pub status: String,
    pub subtotal: i64,
    pub discount: i64,
    pub fees: i64,
    pub total: i64,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    pub seats: Vec<BookingSeatOut>,
    #[serde(rename = "campaignId", skip_serializing_if = "Option::is_none")]
    pub campaign_id: Option<String>,
}

/// Response of `POST /api/bookings/{id}/cancel`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingCancelResponse {
    pub success: bool,
    #[serde(rename = "refundPercent")]
    pub refund_percent: i64,
    #[serde(rename = "refundAmount")]
    pub refund_amount: i64,
    #[serde(rename = "cancelledAt")]
    pub cancelled_at: String,
    #[serde(rename = "refCode")]
    pub ref_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Response of `POST /api/bookings/{id}/confirm`.
#[derive(Debug, Serialize, ToSchema)]
pub struct BookingConfirmResponse {
    #[serde(rename = "bookingId")]
    pub booking_id: Uuid,
    pub status: String,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String,
}
