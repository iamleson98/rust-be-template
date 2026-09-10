//! DTOs for the route-picture media feature (gallery per bus route).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` so Rust field names
//! follow the codebase convention while the wire format stays
//! JavaScript-friendly.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

/// One picture of a route, as shown on the route detail page.
///
/// `url` / `thumbUrl` are ABSOLUTE when `STORAGE_PUBLIC_BASE_URL` is
/// configured (CDN origin, e.g. `https://media.datxevui.com/...`) and
/// backend-relative (`/api/media/...`) otherwise — clients just set
/// them on an `<img src>` either way.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutePictureOut {
    pub id: Uuid,
    pub route_id: Uuid,
    /// Display order; `0` is the cover picture.
    pub sort_order: i64,
    /// Public URL of the ORIGINAL image (content-addressed, immutable).
    pub url: String,
    /// Public URL of the JPEG thumbnail (long edge ≤ 640px) — use this
    /// in lists/grids, `url` in the detail gallery.
    pub thumb_url: String,
    /// Accessible description; `null` when the admin didn't provide one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text: Option<String>,
    /// Original dimensions in pixels (for layout before load).
    pub width: i64,
    pub height: i64,
    pub mime_type: String,
    pub size_bytes: i64,
    pub created_at: String,
}

/// `GET /api/routes/{id}/pictures` — the ordered gallery.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutePictureListResponse {
    pub route_id: Uuid,
    pub items: Vec<RoutePictureOut>,
}

/// `POST /api/admin/routes/{id}/pictures` — upload result.
///
/// `deduped=true` means the exact same bytes were already attached to
/// this route and the EXISTING row is returned (idempotent re-upload).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutePictureUploadResponse {
    pub ok: bool,
    pub deduped: bool,
    pub picture: RoutePictureOut,
}

/// `PATCH /api/admin/routes/{id}/pictures/{pictureId}` — reorder or
/// edit the alt text of one picture. Both fields optional; omitting a
/// field leaves it unchanged.
///
/// Reorder semantics: `sortOrder = S` MOVES the picture to display
/// position S — the others shift to close the gap and make room, and
/// positions stay dense 0..n-1. `0` makes it the cover. Out-of-range
/// positions clamp to the last slot.
#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoutePictureInput {
    /// New display position (`0` = cover). Must be `>= 0`.
    #[validate(range(min = 0))]
    pub sort_order: Option<i64>,
    /// New alt text. `null` CLEARS it; omitting the field keeps it.
    #[validate(length(max = 255))]
    pub alt_text: Option<String>,
}

/// `DELETE .../pictures/{pictureId}` response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutePictureDeleteResponse {
    pub ok: bool,
    pub id: Uuid,
}

/// `DELETE /api/admin/routes/{id}/pictures` — bulk delete response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoutePicturesBulkDeleteResponse {
    pub ok: bool,
    pub deleted: u64,
}
