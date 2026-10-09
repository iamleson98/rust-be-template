//! DTOs for the booking service (`/api/bookings`, `/api/bookings/hold`,
//! `/api/bookings/{id}`, `/api/bookings/{id}/cancel`, `/api/bookings/{id}/place`).
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
    /// Ignored: the server decides from `age` and the brand's child policy.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    #[validate(length(max = 10))]
    pub passenger_type: Option<String>,
    /// Without an age the passenger pays the adult price.
    #[serde(default)]
    #[validate(range(min = 0, max = 150))]
    pub age: Option<i64>,
    /// The passenger's seat (one of `seatIds`). When every passenger names
    /// one, seats are matched by it; otherwise by position.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<Uuid>,
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
    /// Required when the route has pickup points; must be one of them.
    #[serde(default)]
    pub boarding_point_id: Option<Uuid>,
    /// Required when the route has pickup points; must be one of them.
    #[serde(default)]
    pub dropping_point_id: Option<Uuid>,
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

/// One ticket of a booking: the seat and who sits in it.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingSeatOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<Uuid>,
    /// The seat number printed on the ticket (`A01`, `12`, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_name: Option<String>,
    /// `adult` | `child`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_age: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<i64>,
}

/// Where a passenger gets on or off, as it was when the ticket was sold.
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingStop {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
}

/// The trip a booking is for.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingTrip {
    pub id: Uuid,
    /// `YYYY-MM-DD`, local (Vietnam) date.
    pub departure_date: String,
    /// `HH:MM`, local time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_time: Option<String>,
    /// The departure instant (UTC, RFC 3339).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_at: Option<String>,
    pub status: String,
    pub route_id: Uuid,
    pub route_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_accent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_logo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bus_layout_name: Option<String>,
}

/// The customer's review of a trip they took.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingReview {
    pub id: Uuid,
    pub rating: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub tags: Vec<String>,
    pub photos: Vec<String>,
    pub created_at: String,
}

/// A booking (ticket) as customers and staff see it.
///
/// `status`: `pending` (being paid for, or placed and awaiting the
/// operator's phone confirmation when `paymentMethod` is `cod`) →
/// `confirmed` → `completed`; or `cancelled`. Completed and cancelled are
/// final.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingOut {
    pub id: Uuid,
    pub code: String,
    pub status: String,
    /// `cod` (pay on board) or an online provider; absent while unpaid.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    pub adult_count: i64,
    pub child_count: i64,
    pub subtotal: i64,
    pub discount: i64,
    pub fees: i64,
    pub total: i64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pickup: Option<BookingStop>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropoff: Option<BookingStop>,
    pub seats: Vec<BookingSeatOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trip: Option<BookingTrip>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<BookingReview>,
    /// The customer may still cancel (open, and the trip has not left).
    pub can_cancel: bool,
    /// Boarding QR (an SVG data URI encoding the code) for an open ticket;
    /// only on the single-booking views.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ticket_qr: Option<String>,
    /// When an unconfirmed booking lets its seats go.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Response of `GET /api/bookings`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingListResponse {
    pub items: Vec<BookingOut>,
}

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

/// A booking's state after it is placed (`POST /api/bookings/{id}/place`)
/// or confirmed.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookingConfirmResponse {
    pub booking_id: Uuid,
    pub status: String,
    pub payment_method: String,
}
