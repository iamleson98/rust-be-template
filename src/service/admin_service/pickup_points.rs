//! Pickup points along a route.

use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, optional_trimmed, AdminService};
use crate::dto::admin::{
    AdminMutationResponse, AdminPickupPointListResponse, AdminPickupPointOut,
    UpsertPickupPointRequest,
};
use crate::entity::pickup_point;
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List pickup points for a route.
    pub async fn list_pickup_points(
        &self,
        route_id: &str,
    ) -> AppResult<AdminPickupPointListResponse> {
        let points = self
            .store
            .route_store()
            .list_pickup_points_by_route(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<AdminPickupPointOut> = points
            .iter()
            .map(|p| AdminPickupPointOut {
                id: p.id,
                route_id: p.route_id,
                name: p.name.clone(),
                address: p.address.clone(),
                lat: p.lat,
                lon: p.lon,
                stop_order: p.stop_order,
                kind: p.kind.clone(),
                created_at: p.created_at.clone(),
            })
            .collect();
        Ok(AdminPickupPointListResponse { items })
    }

    /// Create a new pickup point.
    pub async fn create_pickup_point(
        &self,
        body: &UpsertPickupPointRequest,
    ) -> AppResult<AdminMutationResponse> {
        let route_id = body
            .route_id
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?;
        self.ensure_route_exists(route_id).await?;
        check_coordinates(body.lat, body.lon)?;

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = pickup_point::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            name: Set(body.name.clone()),
            address: Set(optional_trimmed(body.address.as_deref())),
            lat: Set(body.lat),
            lon: Set(body.lon),
            stop_order: Set(body.stop_order.unwrap_or(0)),
            kind: Set(optional_trimmed(body.kind.as_deref())),
            created_at: Set(now),
        };

        self.store
            .route_store()
            .insert_pickup_point(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Update a pickup point by id: a field left out keeps its value, a
    /// blank address or kind is cleared.
    pub async fn update_pickup_point(
        &self,
        id: Uuid,
        body: &UpsertPickupPointRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .route_store()
            .find_pickup_point_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("pickup point not found".into()))?;

        check_coordinates(body.lat, body.lon)?;
        if let Some(route_id) = body.route_id {
            self.ensure_route_exists(route_id).await?;
        }

        let mut active: pickup_point::ActiveModel = existing.into();

        if let Some(route_id) = body.route_id {
            active.route_id = Set(route_id);
        }
        if let Some(ref v) = body.name {
            active.name = Set(Some(v.clone()));
        }
        if body.address.is_some() {
            active.address = Set(optional_trimmed(body.address.as_deref()));
        }
        if let Some(v) = body.lat {
            active.lat = Set(Some(v));
        }
        if let Some(v) = body.lon {
            active.lon = Set(Some(v));
        }
        if let Some(v) = body.stop_order {
            active.stop_order = Set(v);
        }
        if body.kind.is_some() {
            active.kind = Set(optional_trimmed(body.kind.as_deref()));
        }

        self.store
            .route_store()
            .update_pickup_point(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Delete a pickup point by id.
    pub async fn delete_pickup_point(&self, id: Uuid) -> AppResult<()> {
        self.store
            .route_store()
            .delete_pickup_point(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }
}

/// The geo search reads these as degrees, so an impossible point is refused.
fn check_coordinates(lat: Option<f64>, lon: Option<f64>) -> AppResult<()> {
    if lat.is_some_and(|v| !(-90.0..=90.0).contains(&v)) {
        return Err(AppError::Validation("lat must be within -90..90".into()));
    }
    if lon.is_some_and(|v| !(-180.0..=180.0).contains(&v)) {
        return Err(AppError::Validation("lon must be within -180..180".into()));
    }
    Ok(())
}
