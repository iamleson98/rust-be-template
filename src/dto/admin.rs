//! DTOs for the admin namespace (`/api/admin/*`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` for wire-shape
//! consistency with the rest of the API.
//!
//! These mirror the public DTOs but add admin-only fields (route/layout
//! counts, audit metadata, etc.) that the admin dashboard needs.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::validation::validate_phone;

fn empty_string_as_none<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
        .map(|value| value.filter(|value| !value.trim().is_empty()))
}

// ────────────────────────────────────────────────────────────────
//  Brands
// ────────────────────────────────────────────────────────────────

/// Admin brand list item — like `BrandOut` but with `routeCount` + `layoutCount`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBrandOut {
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
    pub rating: Option<f64>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    pub total_trips: i64,
    pub created_at: String,
    pub updated_at: String,
    pub route_count: i64,
    pub layout_count: i64,
}

/// Response of `GET /api/admin/brands`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBrandListResponse {
    pub items: Vec<AdminBrandOut>,
}

/// Request body for `POST /api/admin/brands` (create) and
/// `PUT /api/admin/brands/{id}` (update — all fields optional).
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertBrandRequest {
    #[validate(length(min = 1, max = 255))]
    pub name: Option<String>,
    #[validate(length(min = 1, max = 120))]
    pub slug: Option<String>,
    #[validate(length(max = 500))]
    pub logo_url: Option<String>,
    #[validate(length(max = 5000))]
    pub description: Option<String>,
    #[validate(length(max = 20), custom(function = "validate_phone"))]
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub contact_phone: Option<String>,
    #[validate(email, length(max = 255))]
    #[serde(default, deserialize_with = "empty_string_as_none")]
    pub contact_email: Option<String>,
    #[validate(range(min = 0.0, max = 5.0))]
    pub rating: Option<f64>,
    #[validate(length(max = 30))]
    pub status: Option<String>,
    #[validate(length(max = 9))]
    pub accent_color: Option<String>,
}

/// Response of `POST /api/admin/brands` + `PUT /api/admin/brands/{id}` + `DELETE`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminMutationResponse {
    pub id: Uuid,
}

// ────────────────────────────────────────────────────────────────
//  Routes
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminPlacePreview {
    /// City slug (e.g. `"ha-noi"`). NOT a UUID — matches the
    /// `start_location_id` / `end_location_id` column type on `route`.
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub province: Option<String>,
}

/// Admin route list item — like `RouteOut` but with start/end place
/// previews and schedule/pickup-point counts.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminRouteOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    pub name: String,
    /// City slug (e.g. `"ha-noi"`). Required — every route has both a
    /// start and an end city. Resolved to `start_location` via
    /// `crate::cities::find_by_slug`.
    pub start_location_id: String,
    pub end_location_id: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_location: Option<AdminPlacePreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_location: Option<AdminPlacePreview>,
    pub schedule_count: usize,
    pub pickup_point_count: i64,
}

/// Response of `GET /api/admin/routes`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminRouteListResponse {
    pub items: Vec<AdminRouteOut>,
}

/// Request body for `POST /api/admin/routes` + `PUT /api/admin/routes/{id}`.
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRouteRequest {
    #[validate(length(min = 1, max = 255))]
    pub name: Option<String>,
    pub brand_id: Option<Uuid>,
    /// City slug (e.g. `"ha-noi"`). Max 20 chars — matches the DB
    /// column `VARCHAR(20) NOT NULL`. The slug MUST be one of the
    /// values in `crate::cities::CITIES`; we don't enforce that here
    /// (validator doesn't have access to the static list) but the
    /// frontend dropdown only sends known slugs. Required — a route
    /// without start/end cities is meaningless.
    #[validate(length(min = 1, max = 20))]
    pub start_location_id: Option<String>,
    #[validate(length(min = 1, max = 20))]
    pub end_location_id: Option<String>,
    #[validate(length(max = 30))]
    pub status: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Addresses (brand-owned geographic points)
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminAddressOut {
    pub id: Uuid,
    pub brand_id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    pub lat: f64,
    pub lon: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub province: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub district: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ward: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Response of `GET /api/admin/addresses`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminAddressListResponse {
    pub items: Vec<AdminAddressOut>,
    /// Total rows matching the brand + `q` filter (for pagination).
    pub total: u64,
}

/// Request body for `POST /api/admin/addresses` + `PUT /api/admin/addresses/{id}`.
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAddressRequest {
    pub brand_id: Option<Uuid>,
    #[validate(length(min = 1, max = 255))]
    pub name: Option<String>,
    #[validate(length(max = 1000))]
    pub address: Option<String>,
    #[validate(range(min = -90.0, max = 90.0))]
    pub lat: Option<f64>,
    #[validate(range(min = -180.0, max = 180.0))]
    pub lon: Option<f64>,
    #[validate(length(max = 100))]
    pub province: Option<String>,
    #[validate(length(max = 100))]
    pub district: Option<String>,
    #[validate(length(max = 100))]
    pub ward: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Schedule points (ordered address sequence)
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminSchedulePointOut {
    pub id: Uuid,
    pub schedule_id: Uuid,
    pub address_id: Uuid,
    pub stop_order: i64,
    /// `pickup` (first) / `middle` / `drop` (last).
    pub kind: String,
    /// Optional `HH:MM` — when the vehicle reaches this stop.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_time: Option<String>,
    pub address: AdminAddressOut,
}

/// One entry of the ordered `points` array on schedule create/update.
/// The array position defines `stopOrder`; `kind` is derived
/// (first = `pickup`, last = `drop`, else `middle`).
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSchedulePointItem {
    pub address_id: Option<Uuid>,
    /// Optional `HH:MM` arrival time at this stop. Validated in the
    /// service (00:00–23:59); `null`/omitted clears it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[validate(length(max = 10))]
    pub arrival_time: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Schedules
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminScheduleOut {
    pub id: Uuid,
    pub route_id: Uuid,
    pub departure_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_of_week: Option<String>,
    /// Bus layout id (string on the wire, `Uuid` in Rust — see the
    /// entity field comment about the old String/TEXT drift).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bus_layout_id: Option<Uuid>,
    /// Explicit vehicle class (`vehicle_type` row). `None` = resolved
    /// through the bus layout (legacy behaviour).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_type_id: Option<Uuid>,
    /// The resolved vehicle class row (schedule's explicit type; the
    /// bus-layout fallback is NOT resolved here — the admin UI shows
    /// the catalog type it configured).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<AdminVehicleTypeOut>,
    pub base_price_adult: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_price_child: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amenities: Option<String>,
    /// Ordered address points (departure → midway stops → destination).
    /// Empty when the schedule has no point sequence yet.
    pub points: Vec<AdminSchedulePointOut>,
    pub created_at: String,
}

/// Response of `GET /api/admin/schedules`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminScheduleListResponse {
    pub items: Vec<AdminScheduleOut>,
}

/// Request body for `POST /api/admin/schedules` + `PUT /api/admin/schedules/{id}`.
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertScheduleRequest {
    pub route_id: Option<Uuid>,
    #[validate(length(min = 1, max = 10))]
    pub departure_time: Option<String>,
    pub effective_from: Option<String>,
    pub effective_to: Option<String>,
    #[validate(length(max = 20))]
    pub days_of_week: Option<String>,
    /// Bus layout id (string on the wire, `Uuid` in Rust).
    pub bus_layout_id: Option<Uuid>,
    /// Vehicle class from the admin-managed `vehicle_type` catalog.
    /// Validated in the service (404-style validation error when unknown).
    pub vehicle_type_id: Option<Uuid>,
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub base_price_adult: Option<i64>,
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub base_price_child: Option<i64>,
    #[validate(length(max = 5000))]
    pub amenities: Option<String>,
    /// When present, replaces the schedule's whole point sequence.
    /// Requires ≥ 2 items (departure + destination); `kind` and
    /// `stopOrder` are derived from the array position.
    pub points: Option<Vec<UpsertSchedulePointItem>>,
}

// ────────────────────────────────────────────────────────────────
//  Pickup points
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminPickupPointOut {
    pub id: Uuid,
    pub route_id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    pub stop_order: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub created_at: String,
}

/// Response of `GET /api/admin/pickup-points`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminPickupPointListResponse {
    pub items: Vec<AdminPickupPointOut>,
}

/// Request body for `POST /api/admin/pickup-points` + `PUT /api/admin/pickup-points/{id}`.
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertPickupPointRequest {
    pub route_id: Option<Uuid>,
    #[validate(length(min = 1, max = 255))]
    pub name: Option<String>,
    #[validate(length(max = 1000))]
    pub address: Option<String>,
    #[validate(range(min = -90.0, max = 90.0))]
    pub lat: Option<f64>,
    #[validate(range(min = -180.0, max = 180.0))]
    pub lon: Option<f64>,
    #[validate(range(min = 0, max = 1000))]
    pub stop_order: Option<i64>,
    #[validate(length(max = 20))]
    pub kind: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Bus layouts
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBusLayoutOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vehicle_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_seats: Option<i16>,
    pub created_at: String,
    pub updated_at: String,
}

/// Response of `GET /api/admin/bus-layouts`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBusLayoutListResponse {
    pub items: Vec<AdminBusLayoutOut>,
}

// ────────────────────────────────────────────────────────────────
//  Vehicle types (admin-managed catalog)
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminVehicleTypeOut {
    pub id: Uuid,
    /// Stable slug (unique, lowercase — matches the legacy
    /// `bus_layout.vehicle_type` codes and the public search filter).
    pub code: String,
    /// Display name (Vietnamese).
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Typical seat count — informational.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_seats: Option<i16>,
    /// Display order in pickers (ascending).
    pub sort_order: i16,
    /// `active` | `disabled`.
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Response of `GET /api/admin/vehicle-types`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminVehicleTypeListResponse {
    pub items: Vec<AdminVehicleTypeOut>,
    /// Total rows matching the filter (for pagination).
    pub total: u64,
}

/// Request body for `POST /api/admin/vehicle-types` +
/// `PUT /api/admin/vehicle-types/{id}`. All fields optional on update
/// (patch semantics); `code`+`label` required on create.
#[derive(Debug, Deserialize, ToSchema, Default, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpsertVehicleTypeRequest {
    /// Required on create, immutable-style identity (must stay a slug).
    #[validate(length(min = 1, max = 60))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[validate(length(min = 1, max = 120))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[validate(length(max = 1000))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[validate(range(min = 1, max = 200))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_seats: Option<i16>,
    #[validate(range(min = 0, max = 1000))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i16>,
    /// `active` | `disabled` (defaults to `active` on create).
    #[validate(length(min = 1, max = 20))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Reviews moderation
// ────────────────────────────────────────────────────────────────

/// Admin review list item — reuses the public `ReviewOut` shape but
/// adds a `reply` field (admin-settable). For now we just re-export
/// `ReviewOut` since the shape is identical.
pub type AdminReviewOut = crate::dto::review::ReviewOut;

/// Response of `GET /api/admin/reviews`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminReviewListResponse {
    pub items: Vec<AdminReviewOut>,
}

/// Request body for `PATCH /api/admin/reviews/{id}` (moderation).
#[derive(Debug, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ModerateReviewRequest {
    /// `pending` | `approved` | `rejected` | `hidden`
    #[validate(length(max = 30))]
    pub status: Option<String>,
    /// Brand's reply text (sets `replied_at` automatically).
    pub brand_reply: Option<Option<String>>,
}

/// Response of `PATCH /api/admin/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModerateReviewResponse {
    pub id: Uuid,
    pub status: String,
}

// ────────────────────────────────────────────────────────────────
//  Bookings management
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingSeatOut {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
    pub price: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_age: Option<i16>,
}

/// Admin booking list item — slim shape for the table view.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingOut {
    pub id: Uuid,
    pub code: String,
    pub status: String,
    pub total: i64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_phone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contact_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pickup_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropoff_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// Response of `GET /api/admin/bookings`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingListResponse {
    pub items: Vec<AdminBookingOut>,
    /// Total matching-row count (independent of pagination). Omitted when
    /// the server didn't compute it (older callers may rely on this).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    pub limit: u64,
    pub offset: u64,
}

/// Admin booking detail — full shape with seats.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingDetail {
    pub id: Uuid,
    pub code: String,
    pub status: String,
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
    pub payment_method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pickup_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dropoff_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub seats: Vec<AdminBookingSeatOut>,
}

/// Response of `GET /api/admin/bookings/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingDetailResponse {
    pub item: AdminBookingDetail,
}

/// Request body for `PATCH /api/admin/bookings/{id}`.
#[derive(Debug, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookingStatusRequest {
    /// `pending` | `confirmed` | `paid` | `completed` | `cancelled` | `refunded`.
    /// `paid` is normalized to `confirmed`; `refunded` to `cancelled`.
    #[validate(length(min = 1, max = 30))]
    pub status: String,
    #[validate(length(max = 1000))]
    pub reason: Option<String>,
    /// When `true`, skips the state-machine transition check (admin override).
    #[serde(default)]
    pub force: bool,
}

/// Response of `PATCH /api/admin/bookings/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookingStatusResponse {
    pub item: AdminBookingStatusUpdate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingStatusUpdate {
    pub id: Uuid,
    pub status: String,
    /// The original requested status (before normalization). Useful
    /// when the caller sends `paid` and we store `confirmed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status: Option<String>,
    pub updated_at: String,
}

// ────────────────────────────────────────────────────────────────
//  Booking stats + export
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingTotals {
    pub total: i64,
    pub revenue: i64,
    pub confirmed: i64,
    pub cancelled: i64,
    pub completed: i64,
    pub pending: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingDayBucket {
    pub date: String,
    pub count: i64,
    pub revenue: i64,
    pub confirmed: i64,
    pub cancelled: i64,
    pub completed: i64,
    pub pending: i64,
}

/// Response of `GET /api/admin/bookings/stats`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingStatsResponse {
    pub totals: AdminBookingTotals,
    pub by_day: Vec<AdminBookingDayBucket>,
}

/// Response of `GET /api/admin/bookings/export`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminBookingExportResponse {
    /// CSV text with UTF-8 BOM (Excel-friendly).
    pub csv: String,
    pub count: usize,
    pub columns: Vec<String>,
    pub filename: String,
}

// ────────────────────────────────────────────────────────────────
//  Query params
// ────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminBookingsQuery {
    pub status: Option<String>,
    pub brand_id: Option<Uuid>,
    pub route_id: Option<Uuid>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub search: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
    pub sort: Option<String>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminReviewsQuery {
    pub status: Option<String>,
    pub brand_id: Option<Uuid>,
    pub route_id: Option<Uuid>,
    pub search: Option<String>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminRoutesQuery {
    pub brand_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminSchedulesQuery {
    pub route_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminAddressesQuery {
    pub brand_id: Option<Uuid>,
    /// Name filter (case-insensitive contains). Feeds the searchable,
    /// infinite-scroll schedule point picker.
    pub q: Option<String>,
    /// Page size. `None` = return every row (legacy full-list consumers).
    pub limit: Option<u64>,
    /// Page offset (0-based) — combined with `limit`.
    pub offset: Option<u64>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminPickupPointsQuery {
    pub route_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminBusLayoutsQuery {
    pub brand_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminVehicleTypesQuery {
    /// Label/code filter (case-insensitive contains).
    pub q: Option<String>,
    /// Page size (default 50, clamped 1-200). `None` = all rows.
    pub limit: Option<u64>,
    /// Page offset (0-based).
    pub offset: Option<u64>,
}

// ────────────────────────────────────────────────────────────────
//  Cron jobs (scheduled background jobs)
// ────────────────────────────────────────────────────────────────

/// One execution of a background job — history / live status row.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CronJobRunOut {
    pub id: Uuid,
    pub job_type: String,
    /// `queued | running | succeeded | failed | cancelled`.
    pub status: String,
    /// Progress / stats JSON (phase, message, bytes, indexed counts…).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    pub created_at: String,
}

/// A scheduled (recurring) job, with its latest run attached.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CronJobOut {
    pub job_type: String,
    /// Human-readable description from the job catalog (absent for
    /// operator-inserted custom rows).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub enabled: bool,
    /// Days between runs.
    pub interval_days: i16,
    /// Local wall-clock hour (0-23) of the fire time.
    pub at_hour: i16,
    /// Local wall-clock minute (0-59) of the fire time.
    pub at_minute: i16,
    /// Next fire time (ISO-8601 UTC). `None` when never armed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<String>,
    /// Latest run, any status — doubles as the live status of an
    /// in-flight run (started + not finished).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<CronJobRunOut>,
    pub updated_at: String,
}

/// Response of `GET /api/admin/cron-jobs`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CronJobListResponse {
    pub items: Vec<CronJobOut>,
    /// Whether the background-jobs subsystem (worker runner + scheduler
    /// tick) is running in this process. `false` (SCHEDULER_ENABLED=false)
    /// → schedules won't fire and triggering returns 503.
    pub scheduler_enabled: bool,
}

/// Response of `GET /api/admin/cron-jobs/runs`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CronJobRunListResponse {
    pub items: Vec<CronJobRunOut>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct CronJobRunsQuery {
    /// Filter by job type (omit for all jobs).
    pub job_type: Option<String>,
    /// Max rows to return (default 20).
    pub limit: Option<u64>,
}

/// Body of `PATCH /api/admin/cron-jobs/{jobType}` — all fields optional;
/// omitted fields keep their current values.
#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCronJobRequest {
    /// Enable (or disable) the schedule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[validate(range(min = 1, max = 365))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_days: Option<i16>,
    #[validate(range(min = 0, max = 23))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at_hour: Option<i16>,
    #[validate(range(min = 0, max = 59))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at_minute: Option<i16>,
    /// Re-arm the next run from now (uses the schedule's time-of-day).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_next_run: Option<bool>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use validator::Validate;

    use super::UpsertBrandRequest;

    #[test]
    fn blank_optional_brand_contacts_are_not_validated() {
        let request: UpsertBrandRequest = serde_json::from_value(json!({
            "name": "Example Brand",
            "slug": "example-brand",
            "contactPhone": "",
            "contactEmail": ""
        }))
        .unwrap();

        assert!(request.contact_phone.is_none());
        assert!(request.contact_email.is_none());
        assert!(request.validate().is_ok());
    }
}
