//! A brand's named stops (stations, offices) that schedules pass through.
//! Each one lies in one of our cities; its province follows from the city.

use sea_orm::Set;
use uuid::Uuid;

use super::{now_iso, optional_trimmed, AdminService};
use crate::cities::{self, City};
use crate::dto::admin::{
    AdminAddressListResponse, AdminAddressOut, AdminMutationResponse, UpsertAddressRequest,
};
use crate::entity::address;
use crate::error::{AppError, AppResult};

impl AdminService {
    /// List addresses owned by a brand (ordered by name), each with the
    /// number of schedule stops that use it.
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
        let stop_counts = self
            .store
            .address_store()
            .count_schedule_points_by_addresses(models.iter().map(|a| a.id).collect())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let items = models
            .iter()
            .map(|a| AdminAddressOut {
                stop_count: Some(stop_counts.get(&a.id).copied().unwrap_or(0)),
                ..address_out(a)
            })
            .collect();
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
        let city = city_of(
            body.city_id
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("cityId is required".into()))?,
        )?;

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
            city_id: Set(Some(city.slug.to_string())),
            province: Set(Some(city.name.to_string())),
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

    /// Update an address by id: a field left out keeps its value, a blank
    /// text field is cleared.
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

        let city = body.city_id.as_deref().map(city_of).transpose()?;

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
        if let Some(city) = city {
            active.city_id = Set(Some(city.slug.to_string()));
            active.province = Set(Some(city.name.to_string()));
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

/// The city a request names by slug; the city and its province always
/// travel together, so only one of our cities is accepted.
fn city_of(slug: &str) -> AppResult<&'static City> {
    let slug = slug.trim();
    if slug.is_empty() {
        return Err(AppError::BadRequest("cityId must not be empty".into()));
    }
    cities::find_by_slug(slug)
        .ok_or_else(|| AppError::BadRequest(format!("cityId: unknown city {slug:?}")))
}

/// Map an `address::Model` to its wire DTO (without the list-only
/// `stopCount`).
pub(super) fn address_out(a: &address::Model) -> AdminAddressOut {
    AdminAddressOut {
        id: a.id,
        brand_id: a.brand_id,
        name: a.name.clone(),
        address: a.address.clone(),
        lat: a.lat,
        lon: a.lon,
        city_id: a.city_id.clone(),
        province: a.province.clone(),
        district: a.district.clone(),
        ward: a.ward.clone(),
        stop_count: None,
        created_at: a.created_at.clone(),
        updated_at: a.updated_at.clone(),
    }
}
