//! DTOs for the wishlist service (`/api/wishlist`, `POST /api/wishlist`,
//! `DELETE /api/wishlist/{id}`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` for wire-shape
//! consistency with the rest of the API.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

/// A wishlist item, as returned by `GET /api/wishlist`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WishlistItemOut {
    pub id: Uuid,
    pub user_id: String,
    pub route_id: String,
    pub created_at: String,
}

/// Response of `GET /api/wishlist`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WishlistListResponse {
    pub items: Vec<WishlistItemOut>,
    pub total: u64,
    pub limit: u64,
    pub offset: u64,
}

/// Request body for `POST /api/wishlist`. Toggles the route in the
/// user's wishlist — if it's already wishlisted, the existing item is
/// removed (toggle off); otherwise a new item is created (toggle on).
#[derive(Debug, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWishlistRequest {
    #[validate(length(max = 64))]
    pub route_id: Option<String>,
    #[validate(length(max = 64))]
    pub trip_id: Option<String>,
    #[validate(length(max = 255))]
    pub from_name: Option<String>,
    #[validate(length(max = 255))]
    pub to_name: Option<String>,
}

/// Response of `POST /api/wishlist`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWishlistResponse {
    pub ok: bool,
    /// `true` when the route is now in the wishlist; `false` when it was
    /// removed by the toggle.
    pub added: bool,
    /// The wishlist item id (present when `added=true`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
}

/// Response of `DELETE /api/wishlist/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWishlistResponse {
    pub ok: bool,
}
