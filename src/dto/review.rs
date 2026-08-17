//! DTOs for the review service (`/api/reviews`, `/api/reviews/tags`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` so Rust field names
//! stay snake_case (Rust convention) while the JSON wire shape is
//! camelCase (JSON/TypeScript convention).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A review row, as returned by `GET /api/reviews` and `GET /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub booking_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trip_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_phone: Option<String>,
    /// 1..=5
    pub rating: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub photos: Vec<String>,
    /// `pending` | `approved` | `rejected`
    pub status: String,
    pub helpful_count: i64,
    /// Brand's reply (admin-written).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replied_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
}

/// Response of `GET /api/reviews`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewListResponse {
    pub items: Vec<ReviewOut>,
}

/// Response of `POST /api/reviews` and `PATCH /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewMutationResponse {
    pub id: Uuid,
}

/// Response of `DELETE /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDeleteResponse {
    pub ok: bool,
}

/// Response of `GET /api/reviews/tags`. Returns the distinct set of
/// tags across all reviews (used by the frontend to render tag filters).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTagsResponse {
    pub items: Vec<String>,
}

// ────────────────────────────────────────────────────────────────
//  Input DTOs
// ────────────────────────────────────────────────────────────────

/// Input for creating a review. Field names on the wire are camelCase
/// (so the frontend can send `{ bookingId, routeId, brandId, rating, ... }`)
/// but the Rust struct uses snake_case.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateReviewInput {
    pub booking_id: Option<String>,
    pub trip_session_id: Option<String>,
    pub route_id: Option<String>,
    pub brand_id: Option<String>,
    pub rating: i32,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub photos: Option<Vec<String>>,
    pub author_name: Option<String>,
    pub author_phone: Option<String>,
    /// Overwritten by the server from the authenticated user.
    #[serde(default)]
    pub user_id: Option<String>,
}

/// Input for updating a review.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReviewInput {
    pub rating: Option<i32>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub photos: Option<Vec<String>>,
}
