//! DTOs for the review service (`/api/reviews`, `/api/reviews/tags`).
//!
//! All DTOs use `#[serde(rename_all = "camelCase")]` so Rust field names
//! stay snake_case (Rust convention) while the JSON wire shape is
//! camelCase (JSON/TypeScript convention).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::validation::validate_phone;

/// A review row, as returned by `GET /api/reviews` and `GET /api/reviews/{id}`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewOut {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub booking_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trip_session_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_id: Option<Uuid>,
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
    pub user_id: Option<Uuid>,
}

/// Response of `GET /api/reviews` (public: `items` only) and
/// `GET /api/reviews/mine` (adds `total`/`limit`/`offset` so the
/// account feedback page can paginate).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewListResponse {
    pub items: Vec<ReviewOut>,
    /// Total matching rows (only set by `/api/reviews/mine`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    /// Echo of the request's `limit` (only set by `/api/reviews/mine`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    /// Echo of the request's `offset` (only set by `/api/reviews/mine`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u64>,
}

impl ReviewListResponse {
    /// Public-list shape (`items` only — `total`/`limit`/`offset` are
    /// omitted from the JSON).
    pub fn public(items: Vec<ReviewOut>) -> Self {
        Self {
            items,
            total: None,
            limit: None,
            offset: None,
        }
    }

    /// Paginated shape for `/api/reviews/mine`.
    pub fn paginated(items: Vec<ReviewOut>, total: u64, limit: u64, offset: u64) -> Self {
        Self {
            items,
            total: Some(total),
            limit: Some(limit),
            offset: Some(offset),
        }
    }
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

/// What the approved reviews in a scope (a brand, a route) add up to —
/// `GET /api/reviews/stats`.
#[derive(Debug, Default, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStats {
    pub count: u64,
    /// Mean rating; absent while there are no reviews.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average: Option<f64>,
    /// Reviews per star rating, five entries: 1 star first, 5 stars last.
    pub by_rating: Vec<u64>,
    /// The most mentioned tags, most first (at most five).
    pub top_tags: Vec<TagCount>,
}

/// One review tag and how many reviews mention it.
#[derive(Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: u64,
}

impl ReviewStats {
    /// Counts `(rating, tags JSON)` rows; ratings outside 1–5 are ignored.
    pub fn tally(rows: &[(i64, Option<String>)]) -> Self {
        let mut by_rating = vec![0u64; 5];
        let mut tags: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        let (mut count, mut sum) = (0u64, 0i64);
        for (rating, tag_json) in rows {
            let Some(bucket) = usize::try_from(*rating)
                .ok()
                .and_then(|r| r.checked_sub(1))
                .and_then(|slot| by_rating.get_mut(slot))
            else {
                continue;
            };
            *bucket += 1;
            count += 1;
            sum += rating;
            let parsed: Vec<String> = tag_json
                .as_deref()
                .and_then(|j| serde_json::from_str(j).ok())
                .unwrap_or_default();
            for tag in parsed {
                *tags.entry(tag).or_default() += 1;
            }
        }
        let mut top_tags: Vec<TagCount> = tags
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();
        top_tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
        top_tags.truncate(5);
        Self {
            count,
            average: (count > 0).then(|| sum as f64 / count as f64),
            by_rating,
            top_tags,
        }
    }
}

// ────────────────────────────────────────────────────────────────
//  Input DTOs
// ────────────────────────────────────────────────────────────────

/// Input for creating a review. Field names on the wire are camelCase
/// (so the frontend can send `{ bookingId, routeId, brandId, rating, ... }`)
/// but the Rust struct uses snake_case.
#[derive(Debug, Clone, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct CreateReviewInput {
    pub booking_id: Option<Uuid>,
    pub trip_session_id: Option<Uuid>,
    pub route_id: Option<Uuid>,
    pub brand_id: Option<Uuid>,
    #[validate(range(min = 1, max = 5))]
    pub rating: i32,
    #[validate(length(max = 255))]
    pub title: Option<String>,
    #[validate(length(max = 10000))]
    pub content: Option<String>,
    #[validate(length(max = 20))]
    pub tags: Option<Vec<String>>,
    #[validate(length(max = 10))]
    pub photos: Option<Vec<String>>,
    #[validate(length(max = 255))]
    pub author_name: Option<String>,
    #[validate(length(max = 20), custom(function = "validate_phone"))]
    pub author_phone: Option<String>,
    /// Overwritten by the server from the authenticated user.
    #[serde(default)]
    pub user_id: Option<Uuid>,
}

/// Input for updating a review.
#[derive(Debug, Clone, Default, Deserialize, ToSchema, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReviewInput {
    #[validate(range(min = 1, max = 5))]
    pub rating: Option<i32>,
    #[validate(length(max = 255))]
    pub title: Option<String>,
    #[validate(length(max = 10000))]
    pub content: Option<String>,
    #[validate(length(max = 20))]
    pub tags: Option<Vec<String>>,
    pub photos: Option<Vec<String>>,
}

#[cfg(test)]
mod stats_tests {
    use super::*;

    #[test]
    fn review_stats_count_stars_and_tags_exactly() {
        let tags = |t: &str| Some(t.to_string());
        let stats = ReviewStats::tally(&[
            (5, tags(r#"["clean","on_time"]"#)),
            (5, tags(r#"["clean"]"#)),
            (4, None),
            (1, tags("not json")),
            (9, tags(r#"["ignored"]"#)),
        ]);
        assert_eq!(stats.count, 4);
        assert_eq!(stats.average, Some(15.0 / 4.0));
        assert_eq!(stats.by_rating, [1, 0, 0, 1, 2]);
        assert_eq!(
            stats.top_tags,
            [
                TagCount {
                    tag: "clean".into(),
                    count: 2
                },
                TagCount {
                    tag: "on_time".into(),
                    count: 1
                },
            ]
        );
        assert_eq!(ReviewStats::tally(&[]).average, None);
    }
}
