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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bus_layout_id: Option<String>,
    pub base_price_adult: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_price_child: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amenities: Option<String>,
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
    pub bus_layout_id: Option<String>,
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub base_price_adult: Option<i64>,
    #[validate(range(min = 0, max = 1_000_000_000))]
    pub base_price_child: Option<i64>,
    #[validate(length(max = 5000))]
    pub amenities: Option<String>,
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
pub struct AdminPickupPointsQuery {
    pub route_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct AdminBusLayoutsQuery {
    pub brand_id: Option<Uuid>,
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
