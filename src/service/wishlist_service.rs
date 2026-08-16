//! Wishlist service — business logic for listing, toggling, and
//! removing wishlist items.
//!
//! Thin wrapper around the `WishlistStore`. The service layer owns
//! input validation (route id format, ownership) and maps raw entity
//! rows to typed DTOs from [`crate::dto::wishlist`].

use std::sync::Arc;

use chrono::Utc;
use sea_orm::Set;
use uuid::Uuid;

use crate::dto::wishlist::{
    DeleteWishlistResponse, ToggleWishlistResponse, WishlistItemOut, WishlistListResponse,
};
use crate::entity::wishlist_item;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

pub struct WishlistService {
    store: Arc<CompositeStore>,
}

impl WishlistService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    /// List the authenticated user's wishlist items, newest first.
    pub async fn list(
        &self,
        user_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> AppResult<WishlistListResponse> {
        let limit = limit.clamp(1, 200);
        let uid_str = user_id.to_string();
        let items = self
            .store
            .wishlist_store()
            .list_by_user(&uid_str, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let total = self
            .store
            .wishlist_store()
            .count_by_user(&uid_str)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items: Vec<WishlistItemOut> = items.into_iter().map(wishlist_item_to_dto).collect();
        Ok(WishlistListResponse {
            items,
            total,
            limit,
            offset,
        })
    }

    /// Toggle a route in the user's wishlist. If the route is already
    /// wishlisted, the existing item is removed (returns `added=false`).
    /// Otherwise a new item is created (returns `added=true`).
    ///
    /// The frontend passes either a `route_id` (preferred) or a
    /// `trip_id` (which we resolve to the trip's route_id).
    pub async fn toggle(
        &self,
        user_id: Uuid,
        route_id: Option<&str>,
        trip_id: Option<&str>,
    ) -> AppResult<ToggleWishlistResponse> {
        // Resolve the route_id from trip_id if needed.
        let route_id = match route_id {
            Some(rid) if !rid.is_empty() => rid.to_string(),
            _ => {
                // The frontend sometimes passes `tripId` instead of
                // `routeId`. We resolve the trip's route_id via the
                // trip store. If neither is provided, error out.
                let tid = trip_id
                    .ok_or_else(|| AppError::BadRequest("routeId or tripId is required".into()))?;
                let trip_uuid = Uuid::parse_str(tid)
                    .map_err(|e| AppError::BadRequest(format!("invalid tripId: {e}")))?;
                let trip = self
                    .store
                    .trip_store()
                    .find_trip_by_id(trip_uuid)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .ok_or_else(|| AppError::NotFound("trip not found".into()))?;
                // The trip's schedule_id references the route — we need
                // to look up the schedule + route to get the route_id.
                let schedule_id = Uuid::parse_str(&trip.schedule_id)
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                let schedule = self
                    .store
                    .schedule_store()
                    .find_schedule_by_id(schedule_id)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;
                schedule.route_id.to_string()
            }
        };

        let uid_str = user_id.to_string();

        // Check if already wishlisted.
        let existing = self
            .store
            .wishlist_store()
            .find_by_user_and_route(&uid_str, &route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(m) = existing {
            // Toggle off — remove the existing item.
            let _ = self
                .store
                .wishlist_store()
                .delete(m.id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            return Ok(ToggleWishlistResponse {
                ok: true,
                added: false,
                id: None,
            });
        }

        // Toggle on — create a new item.
        let id = Uuid::new_v4();
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let model = wishlist_item::ActiveModel {
            id: Set(id),
            user_id: Set(uid_str),
            route_id: Set(route_id),
            created_at: Set(now),
        };
        let stored = self
            .store
            .wishlist_store()
            .insert(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(ToggleWishlistResponse {
            ok: true,
            added: true,
            id: Some(stored.id),
        })
    }

    /// Delete a single wishlist item by id. Ownership is enforced —
    /// only the item's owner can delete it.
    pub async fn remove(&self, user_id: Uuid, id: Uuid) -> AppResult<DeleteWishlistResponse> {
        let uid_str = user_id.to_string();
        let existing = self
            .store
            .wishlist_store()
            .find_by_id_for_user(id, &uid_str)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("wishlist item not found".into()))?;
        let _ = self
            .store
            .wishlist_store()
            .delete(existing.id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(DeleteWishlistResponse { ok: true })
    }
}

/// Map a `wishlist_item::Model` row to the `WishlistItemOut` DTO.
fn wishlist_item_to_dto(w: wishlist_item::Model) -> WishlistItemOut {
    WishlistItemOut {
        id: w.id,
        user_id: w.user_id,
        route_id: w.route_id,
        created_at: w.created_at,
    }
}
