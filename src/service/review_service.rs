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

use crate::dto::admin::{AdminReviewBrandSummary, AdminReviewBrandSummaryListResponse};
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
    /// Free-text search over author name / phone / title / content.
    pub search: Option<String>,
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

    /// List reviews with optional filters (public list — `items` only).
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
                filter.search.as_deref(),
                limit,
                filter.offset,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<ReviewOut> = reviews.iter().map(review_to_dto).collect();
        Ok(ReviewListResponse::public(items))
    }

    /// List the authenticated user's OWN reviews with a true total —
    /// backs `GET /api/reviews/mine` (account feedback history page).
    /// The user_id filter is forced to the caller server-side, never
    /// taken from the query string.
    pub async fn list_mine(
        &self,
        user_id: &str,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> AppResult<ReviewListResponse> {
        let limit = limit.clamp(1, 200);
        let total = self
            .store
            .review_store()
            .count_reviews(None, None, Some(user_id), status, None)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let reviews = self
            .store
            .review_store()
            .list_reviews(
                None,
                None,
                Some(user_id),
                status,
                None,
                limit,
                offset,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items: Vec<ReviewOut> = reviews.iter().map(review_to_dto).collect();
        Ok(ReviewListResponse::paginated(items, total, limit, offset))
    }

    /// Per-brand feedback aggregates for the admin feedback page:
    /// one row per brand (plus a `None` bucket for unattributed rows)
    /// with status counts + average rating, sorted by volume desc.
    pub async fn brand_summary(&self) -> AppResult<AdminReviewBrandSummaryListResponse> {
        let counts = self
            .store
            .review_store()
            .count_reviews_grouped_by_brand_status()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let avgs = self
            .store
            .review_store()
            .avg_rating_grouped_by_brand()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Collect the distinct brand ids referenced by reviews so we
        // can batch-resolve brand metadata (name/slug/logo/accent) in
        // ONE query instead of one-per-brand.
        let mut brand_ids: Vec<Uuid> = Vec::new();
        for (bid, _) in avgs.iter() {
            if let Some(id) = bid {
                if !brand_ids.contains(id) {
                    brand_ids.push(*id);
                }
            }
        }
        // `counts` can contain brand buckets that `avgs` doesn't only
        // in a pathological empty-group edge case; union for safety.
        for (bid, _, _) in counts.iter() {
            if let Some(id) = bid {
                if !brand_ids.contains(id) {
                    brand_ids.push(*id);
                }
            }
        }
        let brand_map: std::collections::HashMap<Uuid, crate::entity::brand::Model> = if brand_ids
            .is_empty()
        {
            std::collections::HashMap::new()
        } else {
            self.store
                .brand_store()
                .list_brands_by_ids(brand_ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|b| (b.id, b))
                .collect()
        };

        #[derive(Default)]
        struct Acc {
            total: i64,
            pending: i64,
            approved: i64,
            rejected: i64,
            hidden: i64,
        }
        let mut by_brand: std::collections::HashMap<Option<Uuid>, Acc> =
            std::collections::HashMap::new();
        for (bid, status, count) in counts {
            let acc = by_brand.entry(bid).or_default();
            acc.total += count;
            match status.as_str() {
                "pending" => acc.pending += count,
                "approved" => acc.approved += count,
                "rejected" => acc.rejected += count,
                "hidden" => acc.hidden += count,
                _ => {}
            }
        }

        let mut items: Vec<AdminReviewBrandSummary> = by_brand
            .into_iter()
            .map(|(bid, acc)| {
                let avg = avgs
                    .iter()
                    .find(|(b, _)| *b == bid)
                    .and_then(|(_, a)| *a)
                    .map(|v| (v * 10.0).round() / 10.0);
                let brand = bid.as_ref().and_then(|id| brand_map.get(id));
                AdminReviewBrandSummary {
                    brand_id: bid,
                    brand_name: brand.map(|b| b.name.clone()),
                    brand_slug: brand.map(|b| b.slug.clone()),
                    brand_logo: brand.and_then(|b| b.logo_url.clone()),
                    brand_accent: brand.and_then(|b| b.accent_color.clone()),
                    total: acc.total,
                    pending: acc.pending,
                    approved: acc.approved,
                    rejected: acc.rejected,
                    hidden: acc.hidden,
                    avg_rating: avg,
                }
            })
            .collect();

        // Highest feedback volume first; unattributed bucket last.
        items.sort_by(|a, b| {
            b.total
                .cmp(&a.total)
                .then_with(|| a.brand_id.is_none().cmp(&b.brand_id.is_none()))
        });

        Ok(AdminReviewBrandSummaryListResponse { items })
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
    ///
    /// **Verified-purchase rule**: when the caller provides a
    /// `booking_id`, the review is only accepted if
    ///   1. the booking exists,
    ///   2. it belongs to the authenticated user,
    ///   3. its status is `completed` (or `confirmed` with the departure
    ///      already in the past — i.e. the user actually rode the trip),
    ///   4. the caller hasn't already reviewed that booking.
    ///
    /// On success the booking's brand/route/trip ids are denormalized
    /// onto the review row so brand-grouped admin views need no JOIN.
    /// After creation, recomputes the brand's average rating.
    pub async fn create(
        &self,
        caller_user_id: Option<&str>,
        input: &CreateReviewInput,
    ) -> AppResult<ReviewMutationResponse> {
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

        // ── Verified-ride checks (booking-scoped reviews) ──────────
        let mut brand_id = input.brand_id;
        let mut route_id = input.route_id;
        let mut trip_session_id = input.trip_session_id;
        let mut author_name = input.author_name.clone();
        let mut author_phone = input.author_phone.clone();

        if let Some(booking_id) = input.booking_id {
            let booking = self
                .store
                .booking_store()
                .find_booking_by_id(booking_id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .ok_or_else(|| {
                    AppError::NotFound("booking not found — you can only review trips you booked".into())
                })?;

            // Ownership: the booking must belong to the caller.
            if let Some(uid) = caller_user_id {
                let owner = booking.user_id.map(|u| u.to_string());
                if owner.as_deref() != Some(uid) {
                    return Err(AppError::Forbidden(
                        "you can only review your own bookings".into(),
                    ));
                }
            }

            // Resolve the trip to check the departure date + to
            // denormalize brand/route/trip onto the review row.
            let trip = self
                .store
                .trip_store()
                .find_trip_by_id(booking.trip_session_id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .ok_or_else(|| {
                    AppError::NotFound("the trip for this booking no longer exists".into())
                })?;

            let departed = trip
                .departure_date
                .as_str()
                .split('T')
                .next()
                .map(|d| d < &Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)[..10])
                .unwrap_or(false);
            let cancelled =
                booking.status == "cancelled" || trip.status == "cancelled";
            if cancelled {
                return Err(AppError::Validation(
                    "cancelled trips cannot be reviewed".into(),
                ));
            }
            if !departed {
                return Err(AppError::Validation(
                    "you can only review trips you have ridden — this trip hasn't departed yet".into(),
                ));
            }

            // Duplicate review guard (one review per booking).
            let mine = self
                .store
                .review_store()
                .list_reviews(None, None, caller_user_id, None, None, 200, 0)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if mine.iter().any(|r| r.booking_id == Some(booking_id)) {
                return Err(AppError::Conflict(
                    "you have already reviewed this booking".into(),
                ));
            }

            // Denormalize: review rides the booking's chain
            // (trip → schedule → route → brand).
            let schedule = self
                .store
                .schedule_store()
                .find_schedule_by_id(trip.schedule_id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if let Some(schedule) = schedule {
                route_id = Some(schedule.route_id);
                if let Some(route) = self
                    .store
                    .route_store()
                    .find_route_by_id(schedule.route_id)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                {
                    brand_id = route.brand_id.or(brand_id);
                }
            }
            trip_session_id = Some(trip.id);
            // Guest bookings carry contact info — surface it as the
            // review author so admin can identify the reviewer.
            // (`contact_name`/`contact_phone` are already
            // `Option<String>`.)
            if author_name.is_none() {
                author_name = booking.contact_name.clone();
            }
            if author_phone.is_none() {
                author_phone = booking.contact_phone.clone();
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
            trip_session_id: Set(trip_session_id),
            route_id: Set(route_id),
            brand_id: Set(brand_id),
            author_name: Set(author_name),
            author_phone: Set(author_phone),
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

        let brand_id = existing.brand_id;

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
