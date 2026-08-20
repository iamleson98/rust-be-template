//! Review service — business logic for review CRUD, listing, and moderation.
//!
//! Ported from `booking-rs/logic/reviews.rs`, adapted to the template's
//! store + `AppError` architecture.
//!
//! ## Design
//! - Validates inputs (rating range, content length, ownership).
//! - Uses `CompositeStore` (ReviewStore + BrandStore) for all DB access.
//! - Maps domain rows to typed DTOs from [`crate::dto::review`].
//! - Recomputes brand rating after create/update/delete.

use std::sync::Arc;

use chrono::Utc;
use sea_orm::Set;
use uuid::Uuid;

use crate::dto::review::{
    CreateReviewInput, ReviewDeleteResponse, ReviewListResponse, ReviewMutationResponse, ReviewOut,
    ReviewTagsResponse, UpdateReviewInput,
};
use crate::entity::review;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

// ────────────────────────────────────────────────────────────────
//  Filter
// ────────────────────────────────────────────────────────────────

/// Filter for listing reviews.
#[derive(Debug, Clone, Default)]
pub struct ReviewListFilter {
    pub brand_id: Option<String>,
    pub route_id: Option<String>,
    pub user_id: Option<String>,
    pub status: Option<String>,
    pub limit: u64,
    pub offset: u64,
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct ReviewService {
    store: Arc<CompositeStore>,
}

impl ReviewService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// List reviews with optional filters.
    pub async fn list(&self, filter: &ReviewListFilter) -> AppResult<ReviewListResponse> {
        let limit = filter.limit.min(200);
        let reviews = self
            .store
            .review_store()
            .list_reviews(
                filter.brand_id.as_deref(),
                filter.route_id.as_deref(),
                filter.user_id.as_deref(),
                filter.status.as_deref(),
                limit,
                filter.offset,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<ReviewOut> = reviews.iter().map(review_to_dto).collect();
        Ok(ReviewListResponse { items })
    }

    /// Get a single review by id.
    pub async fn get(&self, id: Uuid) -> AppResult<ReviewOut> {
        let r = self
            .store
            .review_store()
            .find_review_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("review not found".into()))?;

        Ok(review_to_dto(&r))
    }

    /// Create a new review. Validates rating range and content length.
    /// After creation, recomputes the brand's average rating.
    pub async fn create(&self, input: &CreateReviewInput) -> AppResult<ReviewMutationResponse> {
        // Validate rating
        if input.rating < 1 || input.rating > 5 {
            return Err(AppError::Validation("rating must be 1-5".into()));
        }

        // Validate content length if provided
        if let Some(ref content) = input.content {
            if content.len() > 5000 {
                return Err(AppError::Validation(
                    "content must be at most 5000 characters".into(),
                ));
            }
        }

        let id = Uuid::new_v4();
        let now = now_iso();
        let tags_str = input.tags.as_ref().map(|t| t.join(",")).unwrap_or_default();
        let photos_str = input
            .photos
            .as_ref()
            .map(|p| serde_json::to_string(p).unwrap_or_default())
            .unwrap_or_default();

        let model = review::ActiveModel {
            id: Set(id),
            booking_id: Set(input.booking_id),
            trip_session_id: Set(input.trip_session_id),
            route_id: Set(input.route_id),
            brand_id: Set(input.brand_id),
            author_name: Set(input.author_name.clone()),
            author_phone: Set(input.author_phone.clone()),
            rating: Set(input.rating as i64),
            title: Set(input.title.clone()),
            content: Set(input.content.clone()),
            tags: Set(if tags_str.is_empty() {
                None
            } else {
                Some(tags_str)
            }),
            photos: Set(if photos_str.is_empty() {
                None
            } else {
                Some(photos_str)
            }),
            status: Set("pending".to_string()),
            helpful_count: Set(0),
            reply: Set(None),
            replied_at: Set(None),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            user_id: Set(input.user_id),
        };

        self.store
            .review_store()
            .insert_review(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Recompute brand rating (best-effort)
        if let Some(bid) = input.brand_id {
            let _ = self.recompute_brand_rating(&bid.to_string()).await;
        }

        Ok(ReviewMutationResponse { id })
    }

    /// Update a review. Only the author can update their own review.
    /// After update, recomputes the brand's average rating.
    pub async fn update(
        &self,
        id: Uuid,
        caller_user_id: Option<&str>,
        input: &UpdateReviewInput,
    ) -> AppResult<ReviewMutationResponse> {
        let existing = self
            .store
            .review_store()
            .find_review_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("review not found".into()))?;

        // Ownership check
        if let Some(uid) = caller_user_id {
            if existing.user_id.map(|id| id.to_string()).as_deref() != Some(uid) {
                return Err(AppError::Forbidden(
                    "can only update your own reviews".into(),
                ));
            }
        }

        // Validate rating
        if let Some(rating) = input.rating {
            if !(1..=5).contains(&rating) {
                return Err(AppError::Validation("rating must be 1-5".into()));
            }
        }

        let mut active: review::ActiveModel = existing.into();

        if let Some(rating) = input.rating {
            active.rating = Set(rating as i64);
        }
        if let Some(ref title) = input.title {
            active.title = Set(Some(title.clone()));
        }
        if let Some(ref content) = input.content {
            if content.len() > 5000 {
                return Err(AppError::Validation(
                    "content must be at most 5000 characters".into(),
                ));
            }
            active.content = Set(Some(content.clone()));
        }
        if let Some(ref tags) = input.tags {
            active.tags = Set(Some(tags.join(",")));
        }
        if let Some(ref photos) = input.photos {
            active.photos = Set(Some(serde_json::to_string(photos).unwrap_or_default()));
        }

        active.updated_at = Set(now_iso());

        let result = self
            .store
            .review_store()
            .update_review(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Recompute brand rating (best-effort)
        if let Some(bid) = result.brand_id {
            let _ = self.recompute_brand_rating(&bid.to_string()).await;
        }

        Ok(ReviewMutationResponse { id })
    }

    /// Delete a review. Only the author or an admin can delete.
    pub async fn remove(
        &self,
        id: Uuid,
        caller_user_id: Option<&str>,
    ) -> AppResult<ReviewDeleteResponse> {
        let existing = self
            .store
            .review_store()
            .find_review_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("review not found".into()))?;

        // Ownership check (admin bypass is handled at the route level)
        if let Some(uid) = caller_user_id {
            if existing.user_id.map(|id| id.to_string()).as_deref() != Some(uid) {
                return Err(AppError::Forbidden(
                    "can only delete your own reviews".into(),
                ));
            }
        }

        let brand_id = existing.brand_id.clone();

        self.store
            .review_store()
            .delete_review(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Recompute brand rating (best-effort)
        if let Some(bid) = brand_id {
            let _ = self.recompute_brand_rating(&bid.to_string()).await;
        }

        Ok(ReviewDeleteResponse { ok: true })
    }

    /// List available review tags (distinct tags from all reviews).
    pub async fn tags_index(&self) -> AppResult<ReviewTagsResponse> {
        // Single SQL projection (only the `tags` column) instead of loading
        // every review row in full. At 10k reviews this saves several MB
        // of allocation per call.
        let tags = self.store.review_store().list_distinct_tags(None).await?;
        Ok(ReviewTagsResponse { items: tags })
    }

    // ── Private helpers ─────────────────────────────────────────

    /// Recompute the average rating for a brand from all its approved reviews.
    async fn recompute_brand_rating(&self, brand_id: &str) -> AppResult<()> {
        let reviews = self
            .store
            .review_store()
            .list_reviews_by_brand(brand_id, "approved")
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let avg = if reviews.is_empty() {
            None
        } else {
            let sum: i64 = reviews.iter().map(|r| r.rating).sum();
            Some(sum as f64 / reviews.len() as f64)
        };

        // Update the brand's rating
        let brand_id_uuid =
            Uuid::parse_str(brand_id).map_err(|e| AppError::Internal(e.to_string()))?;
        self.store
            .brand_store()
            .update_brand_rating(brand_id_uuid, avg)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────
//  Serialization helpers
// ────────────────────────────────────────────────────────────────

/// Map a `review::Model` row to the `ReviewOut` DTO.
pub fn review_to_dto(r: &review::Model) -> ReviewOut {
    let tags: Vec<String> = r
        .tags
        .as_deref()
        .unwrap_or("")
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    let photos: Vec<String> = r
        .photos
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    ReviewOut {
        id: r.id,
        booking_id: r.booking_id,
        trip_session_id: r.trip_session_id,
        route_id: r.route_id,
        brand_id: r.brand_id,
        author_name: r.author_name.clone(),
        author_phone: r.author_phone.clone(),
        rating: r.rating,
        title: r.title.clone(),
        content: r.content.clone(),
        tags,
        photos,
        status: r.status.clone(),
        helpful_count: r.helpful_count,
        reply: r.reply.clone(),
        replied_at: r.replied_at.clone(),
        created_at: r.created_at.clone(),
        updated_at: r.updated_at.clone(),
        user_id: r.user_id,
    }
}

/// Current UTC time as ISO 8601 string.
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
