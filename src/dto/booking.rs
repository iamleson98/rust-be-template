//! DTOs for the booking service (`/api/bookings`, `/api/bookings/hold`,
//! `/api/bookings/{id}`, `/api/bookings/{id}/cancel`, `/api/bookings/{id}/confirm`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` so Rust field names
//! stay snake_case (Rust convention) while the JSON wire shape is
//! camelCase (JSON/TypeScript convention).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::validation::validate_phone;

// ────────────────────────────────────────────────────────────────
//  Request DTOs
// ────────────────────────────────────────────────────────────────

/// One passenger on a booking.
#[derive(Debug, Deserialize, Clone, Serialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct PassengerReq {
    #[validate(length(min = 1, max = 255))]
    pub name: String,
    /// `adult` | `child` | `infant`. Serialized as `type` on the wire
    /// (matches the legacy field name the frontend sends).
    #[serde(rename = "type")]
    #[validate(length(min = 1, max = 10))]
    pub passenger_type: String,
    #[serde(default)]
    #[validate(range(min = 0, max = 150))]
    pub age: i64,
}

/// Request body for `POST /api/bookings` and `POST /api/bookings/hold`.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct HoldReq {
    pub trip_id: Uuid,
    #[validate(length(min = 1, max = 50))]
    pub seat_ids: Vec<Uuid>,
    #[validate(length(min = 1, max = 50))]
    pub passengers: Vec<PassengerReq>,
    pub boarding_point_id: Uuid,
    pub dropping_point_id: Uuid,
    #[validate(length(min = 1, max = 255))]
    pub contact_name: String,
    #[validate(length(min = 1, max = 20), custom(function = "validate_phone"))]
    pub contact_phone: String,
    #[serde(default)]
    #[validate(email, length(max = 255))]
    pub contact_email: Option<String>,
    #[serde(default)]
    #[validate(length(max = 50))]
    pub campaign_code: Option<String>,
}

/// Request body for `POST /api/bookings/:id/confirm`.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmReq {
    #[serde(default = "default_payment")]
    #[validate(length(max = 30))]
    pub payment_method: String,
}

fn default_payment() -> String {
    "momo".into()
}

/// Request body for `POST /api/bookings/:id/cancel`.
#[derive(Debug, Deserialize, Clone, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CancelReq {
    #[serde(default)]
    #[validate(length(max = 1000))]
    pub reason: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Response DTOs
// ────────────────────────────────────────────────────────────────

/// A held seat inside a booking response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingSeatOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_age: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<i64>,
}

/// Slim trip preview embedded in `BookingListItem`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingTripPreview {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_name: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_accent: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_logo: Option<String>,
    /// Present on the booking-list payload (not the detail payload).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<String>,
    /// Present on the detail payload (not the list payload).
    pub route: Option<BookingRoutePreview>,
    /// Present on the detail payload (not the list payload).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bus_layout: Option<BookingBusLayoutPreview>,
    /// Present on the detail payload (not the list payload).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub pickup_points: Vec<PickupPointOut>,
}

/// Route preview embedded in `BookingTripPreview`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingRoutePreview {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance_km: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_min: Option<i16>,
    pub brand: BookingBrandPreview,
}

/// Brand preview embedded in `BookingRoutePreview`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingBrandPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
}

/// Bus layout preview embedded in `BookingTripPreview`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingBusLayoutPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<String>,
}

/// Pickup point embedded in `BookingTripPreview.pickup_points`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PickupPointOut {
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

/// Response of `GET /api/bookings` (list item) and `GET /api/bookings/{id}`
/// (detail — same shape, just with the full trip preview filled in).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingListItem {
    pub id: Uuid,
    pub code: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adult_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_count: Option<i64>,
    pub subtotal: i64,
    pub discount: i64,
    pub fees: i64,
    pub total: i64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    /// Present on the list-with-detail shape (`include_boarding_dropping_ids=true`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boarding_point_id: Option<String>,
    /// Present on the list-with-detail shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropping_point_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    /// Timestamp when the booking was paid (`updated_at` snapshot at status=confirmed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paid_at: Option<String>,
    pub seats: Vec<BookingSeatOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trip: Option<BookingTripPreview>,
}

/// Response of `GET /api/bookings`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingListResponse {
    pub items: Vec<BookingListItem>,
    /// Total matching-row count (independent of pagination). Omitted from
    /// the JSON when the server didn't compute it (e.g. for the lookup
    /// endpoint). Use `with_total(...)` to set it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
}

impl BookingListResponse {
    pub fn new(items: Vec<BookingListItem>) -> Self {
        Self { items, total: None }
    }

    pub fn with_total(mut self, total: u64) -> Self {
        self.total = Some(total);
        self
    }
}

/// Response of `GET /api/bookings/lookup`. Same shape as the list, but
/// without the `total` field (the lookup endpoint doesn't paginate).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingLookupResponse {
    pub items: Vec<BookingListItem>,
}

/// Response of `GET /api/bookings/{id}`. Carries the full enriched
/// detail (seats + trip + route + brand + pickup points + bus layout).
pub type BookingDetailResponse = BookingListItem;

/// Response of `POST /api/bookings` and `POST /api/bookings/hold`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingHoldResponse {
    pub booking_id: Uuid,
    pub code: String,
    pub status: String,
    pub subtotal: i64,
    pub discount: i64,
    pub fees: i64,
    pub total: i64,
    pub expires_at: String,
    pub seats: Vec<BookingSeatOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub campaign_id: Option<String>,
}

/// Response of `POST /api/bookings/{id}/cancel`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingCancelResponse {
    pub success: bool,
    pub refund_percent: i64,
    pub refund_amount: i64,
    pub cancelled_at: String,
    pub ref_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Response of `POST /api/bookings/{id}/confirm`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingConfirmResponse {
    pub booking_id: Uuid,
    pub status: String,
    pub payment_method: String,
}
