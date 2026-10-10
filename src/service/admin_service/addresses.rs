//! A brand's named stops (stations, offices) that schedules pass through.

use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, optional_trimmed, AdminService};
use crate::dto::admin::{
    AdminAddressListResponse, AdminAddressOut, AdminMutationResponse, UpsertAddressRequest,
};
use crate::entity::address;
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List addresses owned by a brand (ordered by name).
    pub async fn list_addresses(
        &self,
        brand_id: &str,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminAddressListResponse> {
        let (models, total) = self
            .store
            .address_store()
            .list_addresses_by_brand_page(brand_id, q, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items: Vec<AdminAddressOut> = models.iter().map(address_out).collect();
        Ok(AdminAddressListResponse { items, total })
    }

    /// Create a new address for a brand.
    pub async fn create_address(
        &self,
        body: &UpsertAddressRequest,
    ) -> AppResult<AdminMutationResponse> {
        let brand_id = body
            .brand_id
            .ok_or_else(|| AppError::BadRequest("brandId is required".into()))?;
        let name = body
            .name
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("name is required".into()))?
            .to_string();
        let lat = body
            .lat
            .ok_or_else(|| AppError::BadRequest("lat is required".into()))?;
        let lon = body
            .lon
            .ok_or_else(|| AppError::BadRequest("lon is required".into()))?;

        if !(-90.0..=90.0).contains(&lat) {
            return Err(AppError::Validation("lat must be within -90..90".into()));
        }
        if !(-180.0..=180.0).contains(&lon) {
            return Err(AppError::Validation("lon must be within -180..180".into()));
        }

        // The owning brand must exist.
        let _brand = self
            .store
            .brand_store()
            .get_by_id(brand_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("brand not found".into()))?;

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = address::ActiveModel {
            id: Set(id),
            brand_id: Set(brand_id),
            name: Set(name),
            address: Set(optional_trimmed(body.address.as_deref())),
            lat: Set(lat),
            lon: Set(lon),
            province: Set(optional_trimmed(body.province.as_deref())),
            district: Set(optional_trimmed(body.district.as_deref())),
            ward: Set(optional_trimmed(body.ward.as_deref())),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };

        self.store
            .address_store()
            .insert_address(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Update an address by id (set-only-present-fields semantics).
    pub async fn update_address(
        &self,
        id: Uuid,
        body: &UpsertAddressRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .address_store()
            .find_address_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("address not found".into()))?;

        if let Some(brand_id) = body.brand_id {
            if brand_id != existing.brand_id {
                return Err(AppError::Validation(
                    "address cannot move to a different brand".into(),
                ));
            }
        }

        if let Some(ref v) = body.name {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                return Err(AppError::Validation("name cannot be empty".into()));
            }
        }

        if let Some(v) = body.lat {
            if !(-90.0..=90.0).contains(&v) {
                return Err(AppError::Validation("lat must be within -90..90".into()));
            }
        }
        if let Some(v) = body.lon {
            if !(-180.0..=180.0).contains(&v) {
                return Err(AppError::Validation("lon must be within -180..180".into()));
            }
        }

        let mut active: address::ActiveModel = existing.into();
        if let Some(ref v) = body.name {
            active.name = Set(v.trim().to_string());
        }
        if body.address.is_some() {
            active.address = Set(optional_trimmed(body.address.as_deref()));
        }
        if let Some(v) = body.lat {
            active.lat = Set(v);
        }
        if let Some(v) = body.lon {
            active.lon = Set(v);
        }
        if body.province.is_some() {
            active.province = Set(optional_trimmed(body.province.as_deref()));
        }
        if body.district.is_some() {
            active.district = Set(optional_trimmed(body.district.as_deref()));
        }
        if body.ward.is_some() {
            active.ward = Set(optional_trimmed(body.ward.as_deref()));
        }
        active.updated_at = Set(now_iso());

        self.store
            .address_store()
            .update_address(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Delete an address by id. Refused while any schedule still references it.
    pub async fn delete_address(&self, id: Uuid) -> AppResult<()> {
        let _existing = self
            .store
            .address_store()
            .find_address_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("address not found".into()))?;

        let refs = self
            .store
            .address_store()
            .count_schedule_points_by_address(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if refs > 0 {
            return Err(AppError::Conflict(
                "address is used by one or more schedules — remove it from those schedules first"
                    .into(),
            ));
        }

        self.store
            .address_store()
            .delete_address(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }
}

/// Map an `address::Model` to its wire DTO.
pub(super) fn address_out(a: &address::Model) -> AdminAddressOut {
    AdminAddressOut {
        id: a.id,
        brand_id: a.brand_id,
        name: a.name.clone(),
        address: a.address.clone(),
        lat: a.lat,
        lon: a.lon,
        province: a.province.clone(),
        district: a.district.clone(),
        ward: a.ward.clone(),
        created_at: a.created_at.clone(),
        updated_at: a.updated_at.clone(),
    }
}
