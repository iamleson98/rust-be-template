//! DTOs for the review service (`/api/reviews`, `/api/reviews/tags`).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A review row, as returned by `GET /api/reviews` and `GET /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewOut {
    pub id: Uuid,
    #[serde(rename = "bookingId")]
    pub booking_id: Option<String>,
    #[serde(rename = "tripSessionId")]
    pub trip_session_id: Option<String>,
    #[serde(rename = "routeId")]
    pub route_id: Option<String>,
    #[serde(rename = "brandId")]
    pub brand_id: Option<String>,
    #[serde(rename = "authorName")]
    pub author_name: Option<String>,
    #[serde(rename = "authorPhone")]
    pub author_phone: Option<String>,
    /// 1..=5
    pub rating: i64,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Vec<String>,
    pub photos: Vec<String>,
    /// `pending` | `approved` | `rejected`
    pub status: String,
    #[serde(rename = "helpfulCount")]
    pub helpful_count: i64,
    /// Brand's reply (admin-written).
    pub reply: Option<String>,
    #[serde(rename = "repliedAt")]
    pub replied_at: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
}

/// Response of `GET /api/reviews`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewListResponse {
    pub items: Vec<ReviewOut>,
}

/// Response of `POST /api/reviews` and `PATCH /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewMutationResponse {
    pub id: Uuid,
}

/// Response of `DELETE /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewDeleteResponse {
    pub ok: bool,
}

/// Response of `GET /api/reviews/tags`. Returns the distinct set of
/// tags across all reviews (used by the frontend to render tag filters).
#[derive(Debug, Serialize, ToSchema)]
pub struct ReviewTagsResponse {
    pub items: Vec<String>,
}

// ────────────────────────────────────────────────────────────────
//  Input DTOs (declared here instead of in `review_service.rs` so the
//  OpenAPI spec references a single module for review schemas)
// ────────────────────────────────────────────────────────────────

/// Input for creating a review.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct CreateReviewInput {
    #[serde(rename = "booking_id")]
    pub booking_id: Option<String>,
    #[serde(rename = "trip_session_id")]
    pub trip_session_id: Option<String>,
    #[serde(rename = "route_id")]
    pub route_id: Option<String>,
    #[serde(rename = "brand_id")]
    pub brand_id: Option<String>,
    pub rating: i32,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub photos: Option<Vec<String>>,
    #[serde(rename = "author_name")]
    pub author_name: Option<String>,
    #[serde(rename = "author_phone")]
    pub author_phone: Option<String>,
    /// Overwritten by the server from the authenticated user.
    #[serde(rename = "user_id", default)]
    pub user_id: Option<String>,
}

/// Input for updating a review.
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
pub struct UpdateReviewInput {
    pub rating: Option<i32>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub photos: Option<Vec<String>>,
}
