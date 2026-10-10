//! Pickup points along a route.

use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, AdminService};
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

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = pickup_point::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            name: Set(body.name.clone()),
            address: Set(body.address.clone()),
            lat: Set(body.lat),
            lon: Set(body.lon),
            stop_order: Set(body.stop_order.unwrap_or(0)),
            kind: Set(body.kind.clone()),
            created_at: Set(now),
        };

        self.store
            .route_store()
            .insert_pickup_point(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Update a pickup point by id.
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

        let mut active: pickup_point::ActiveModel = existing.into();

        if let Some(ref v) = body.name {
            active.name = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.address {
            active.address = Set(Some(v.clone()));
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
        if let Some(ref v) = body.kind {
            active.kind = Set(Some(v.clone()));
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
