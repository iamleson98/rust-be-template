//! Review moderation.

use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, AdminService};
use crate::dto::admin::{AdminReviewListResponse, ModerateReviewRequest, ModerateReviewResponse};
use crate::entity::review;
use crate::error::{AppError, AppResult};
use crate::service::review_service::recompute_brand_rating;

impl AdminService {
    /// List reviews with admin filters (status, brand, route,
    /// free-text search) + a true `total` for server-side pagination.
    pub async fn list_reviews(
        &self,
        status: Option<&str>,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        search: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> AppResult<AdminReviewListResponse> {
        let limit = limit.clamp(1, 200);
        let total = self
            .store
            .review_store()
            .count_reviews(brand_id, route_id, None, status, search)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let reviews = self
            .store
            .review_store()
            .list_reviews(brand_id, route_id, None, status, search, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<crate::dto::review::ReviewOut> = reviews
            .iter()
            .map(crate::service::review_service::review_to_dto)
            .collect();
        Ok(AdminReviewListResponse {
            items,
            total,
            limit,
            offset,
        })
    }

    /// Update review status (approve / reject / hide) + optional reply.
    pub async fn update_review_status(
        &self,
        id: Uuid,
        body: &ModerateReviewRequest,
    ) -> AppResult<ModerateReviewResponse> {
        let status = body
            .status
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        if let Some(s) = status {
            let valid = ["pending", "approved", "rejected", "hidden"];
            if !valid.contains(&s) {
                return Err(AppError::BadRequest(format!("invalid status: {}", s)));
            }
        }

        let existing = self
            .store
            .review_store()
            .find_review_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("review not found".into()))?;

        let mut active: review::ActiveModel = existing.into();
        if let Some(s) = status {
            active.status = Set(s.to_string());
        }
        // brand_reply semantics:
        //   `Some(Some(text))`  → set reply to text
        //   `Some(None)`        → clear reply (set to NULL)
        //   `None`              → leave reply as-is
        if let Some(ref opt_reply) = body.brand_reply {
            match opt_reply {
                Some(r) => {
                    active.reply = Set(Some(r.clone()));
                    active.replied_at = Set(Some(now_iso()));
                }
                None => {
                    active.reply = Set(None);
                    active.replied_at = Set(None);
                }
            }
        }
        active.updated_at = Set(now_iso());

        let updated = self
            .store
            .review_store()
            .update_review(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // A status change (approve / reject / hide) changes the APPROVED
        // set the brand's average rating is computed over — recompute it
        // so the stored rating (and the rating-ordered public catalog)
        // doesn't drift until the next user-driven review event. A pure
        // `brand_reply` edit doesn't touch the average — skip it.
        if status.is_some() {
            if let Some(brand_id) = updated.brand_id {
                if let Err(e) = recompute_brand_rating(&self.store, &brand_id.to_string()).await {
                    // The moderation itself succeeded — log + continue rather
                    // than failing the whole request over the derived rating.
                    tracing::warn!(
                        brand_id = %brand_id,
                        error = ?e,
                        "post-moderation brand rating recompute failed"
                    );
                }
            }
        }

        Ok(ModerateReviewResponse {
            id,
            status: updated.status,
        })
    }
}
