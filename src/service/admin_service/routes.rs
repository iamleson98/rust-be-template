//! Routes between two places, owned by a brand.

use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, AdminService};
use crate::dto::admin::{
    AdminMutationResponse, AdminPlacePreview, AdminRouteListResponse, AdminRouteOut,
    UpsertRouteRequest,
};
use crate::entity::route;
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List routes with start/end place names and schedule/pickup
    /// counts, with an optional brand filter + case-insensitive search
    /// and offset pagination (`limit=None` returns every matching row,
    /// matching the legacy "fetch all" behaviour for the schedule form).
    pub async fn list_routes(
        &self,
        brand_id: Option<&str>,
        q: Option<&str>,
        start_location_id: Option<&str>,
        end_location_id: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminRouteListResponse> {
        let limit = limit.map(|l| l.clamp(1, 200));
        let page = self
            .store
            .route_store()
            .list_routes_page(
                brand_id,
                q,
                start_location_id,
                end_location_id,
                limit,
                offset,
            )
            .await?;
        let routes = page.items;

        // Batched counts — replaces the previous N+1 pattern of
        // per-route count_schedules_by_route + count_pickup_points_by_route.
        let route_id_strings: Vec<String> = routes.iter().map(|r| r.id.to_string()).collect();
        let schedule_count_map = self
            .store
            .schedule_store()
            .count_schedules_by_route_map(route_id_strings.clone())
            .await
            .unwrap_or_default();
        let pickup_count_map = self
            .store
            .route_store()
            .count_pickup_points_by_route_map(route_id_strings.clone())
            .await
            .unwrap_or_default();

        // Resolve start/end location slugs to city previews via the
        // hardcoded city table (no DB round-trip). Replaces the previous
        // batched `place_store().find_places_by_ids(place_uuids)` lookup
        // — `route.start_location_id` is now a slug string, not a UUID
        // FK to `place`. Both columns are NOT NULL, so we always have
        // a slug — `find_by_slug` returns `None` only if the slug
        // doesn't match any hardcoded city (data corruption case).
        let mut items = Vec::with_capacity(routes.len());
        for r in &routes {
            let route_id_str = r.id.to_string();
            let schedule_count = *schedule_count_map.get(&route_id_str).unwrap_or(&0);
            let pickup_count = *pickup_count_map.get(&route_id_str).unwrap_or(&0);

            let start_place =
                crate::cities::find_by_slug(&r.start_location_id).map(|c| AdminPlacePreview {
                    id: c.slug.to_string(),
                    name: c.name.to_string(),
                    province: Some(c.name.to_string()),
                });
            let end_place =
                crate::cities::find_by_slug(&r.end_location_id).map(|c| AdminPlacePreview {
                    id: c.slug.to_string(),
                    name: c.name.to_string(),
                    province: Some(c.name.to_string()),
                });

            items.push(AdminRouteOut {
                id: r.id,
                brand_id: r.brand_id,
                name: r.name.clone(),
                start_location_id: r.start_location_id.clone(),
                end_location_id: r.end_location_id.clone(),
                status: r.status.clone(),
                created_at: r.created_at.clone(),
                updated_at: r.updated_at.clone(),
                start_location: start_place,
                end_location: end_place,
                schedule_count,
                pickup_point_count: pickup_count as i64,
            });
        }
        Ok(AdminRouteListResponse {
            items,
            total: Some(page.total),
        })
    }

    /// Create a new route.
    pub async fn create_route(
        &self,
        body: &UpsertRouteRequest,
    ) -> AppResult<AdminMutationResponse> {
        let name = body
            .name
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("name is required".into()))?
            .to_string();
        let brand_id = body.brand_id;
        // Both location slugs are required — the DB columns are NOT NULL.
        let start_location_id = body
            .start_location_id
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("start_location_id is required".into()))?
            .to_string();
        let end_location_id = body
            .end_location_id
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("end_location_id is required".into()))?
            .to_string();

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = route::ActiveModel {
            id: Set(id),
            brand_id: Set(brand_id),
            name: Set(name),
            start_location_id: Set(start_location_id),
            end_location_id: Set(end_location_id),
            status: Set(body.status.clone().unwrap_or_else(|| "active".to_string())),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };

        self.store
            .route_store()
            .insert_route(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Update a route by id.
    pub async fn update_route(
        &self,
        id: Uuid,
        body: &UpsertRouteRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .route_store()
            .find_route_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        let mut active: route::ActiveModel = existing.into();

        if let Some(ref v) = body.name {
            active.name = Set(v.clone());
        }
        if let Some(v) = body.brand_id {
            active.brand_id = Set(Some(v));
        }
        // Allow callers to update just one side — but if the field is
        // present, it must be non-empty (DB column is NOT NULL).
        if let Some(ref v) = body.start_location_id {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                return Err(AppError::BadRequest(
                    "start_location_id cannot be empty".into(),
                ));
            }
            active.start_location_id = Set(trimmed.to_string());
        }
        if let Some(ref v) = body.end_location_id {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                return Err(AppError::BadRequest(
                    "end_location_id cannot be empty".into(),
                ));
            }
            active.end_location_id = Set(trimmed.to_string());
        }
        if let Some(ref v) = body.status {
            active.status = Set(v.clone());
        }

        active.updated_at = Set(now_iso());

        self.store
            .route_store()
            .update_route(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Delete a route by id.
    pub async fn delete_route(&self, id: Uuid) -> AppResult<AdminMutationResponse> {
        self.store
            .route_store()
            .delete_route(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminMutationResponse { id })
    }
}
