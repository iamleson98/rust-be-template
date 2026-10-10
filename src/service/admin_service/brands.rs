//! Bus brands (operators).

use sea_orm::Set;
use uuid::Uuid;

use super::validate::{slugify, valid_hex_color, valid_slug};
use super::{now_iso, AdminService};
use crate::dto::admin::{
    AdminBrandListResponse, AdminBrandOut, AdminMutationResponse, UpsertBrandRequest,
};
use crate::dto::fares::ChildFarePolicy;
use crate::entity::brand;
use crate::error::{AppError, AppResult};
use crate::service::fares::{ChildPolicy, MAX_CHILD_AGE};

impl AdminService {
    /// List all brands with route/layout counts.
    pub async fn list_brands(&self) -> AppResult<AdminBrandListResponse> {
        let brands = self
            .store
            .brand_store()
            .list_all(1000, 0)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Batched counts — replaces the previous N+1 pattern of
        // per-brand count_routes_by_brand + count_bus_layouts_by_brand.
        // For 100 brands: 200 round-trips → 2.
        let brand_id_strings: Vec<String> = brands.iter().map(|b| b.id.to_string()).collect();
        let route_count_map = self
            .store
            .route_store()
            .count_routes_by_brand_map(brand_id_strings.clone(), None)
            .await
            .unwrap_or_default();
        let layout_count_map = self
            .store
            .schedule_store()
            .count_bus_layouts_by_brand_map(brand_id_strings.clone())
            .await
            .unwrap_or_default();

        let mut items = Vec::with_capacity(brands.len());
        for b in &brands {
            let brand_id_str = b.id.to_string();
            let route_count = *route_count_map.get(&brand_id_str).unwrap_or(&0);
            let layout_count = *layout_count_map.get(&brand_id_str).unwrap_or(&0);
            items.push(AdminBrandOut {
                id: b.id,
                slug: b.slug.clone(),
                name: b.name.clone(),
                logo_url: b.logo_url.clone(),
                description: b.description.clone(),
                contact_phone: b.contact_phone.clone(),
                contact_email: b.contact_email.clone(),
                rating: b.rating,
                status: b.status.clone(),
                accent_color: b.accent_color.clone(),
                child_fare: ChildPolicy::of(b).map(Into::into),
                created_at: b.created_at.clone(),
                updated_at: b.updated_at.clone(),
                route_count: route_count as i64,
                layout_count: layout_count as i64,
            });
        }
        Ok(AdminBrandListResponse { items })
    }

    /// Create a new brand.
    pub async fn create_brand(
        &self,
        body: &UpsertBrandRequest,
    ) -> AppResult<AdminMutationResponse> {
        let name = body
            .name
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("name is required".into()))?
            .to_string();
        let slug = body
            .slug
            .as_deref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| slugify(&name));

        if !valid_slug(&slug) {
            return Err(AppError::Validation(
                "slug must be lowercase alphanumeric + dashes".into(),
            ));
        }

        let accent_color = body.accent_color.as_deref().map(|s| s.to_string());
        if let Some(ref c) = accent_color {
            if !valid_hex_color(c) {
                return Err(AppError::Validation(
                    "accentColor must be #RRGGBB hex".into(),
                ));
            }
        }

        let child_fare = body
            .child_fare
            .flatten()
            .map(valid_child_fare)
            .transpose()?;
        let id = Uuid::new_v4();
        let now = now_iso();
        let model = brand::ActiveModel {
            id: Set(id),
            slug: Set(slug),
            name: Set(name),
            logo_url: Set(body.logo_url.clone()),
            description: Set(body.description.clone()),
            contact_phone: Set(body.contact_phone.clone()),
            contact_email: Set(body.contact_email.clone()),
            // Computed from approved reviews, never typed in.
            rating: Set(None),
            status: Set(body.status.clone().unwrap_or_else(|| "active".to_string())),
            accent_color: Set(accent_color),
            total_trips: Set(0),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            child_max_age: Set(child_fare.map(|p| p.max_age)),
            child_discount_percent: Set(child_fare.map(|p| p.discount_percent)),
        };

        self.store
            .brand_store()
            .insert_brand(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Update a brand by id.
    pub async fn update_brand(
        &self,
        id: Uuid,
        body: &UpsertBrandRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .brand_store()
            .get_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("brand not found".into()))?;

        let mut active: brand::ActiveModel = existing.into();

        if let Some(ref v) = body.name {
            active.name = Set(v.clone());
        }
        if let Some(ref v) = body.slug {
            if !valid_slug(v) {
                return Err(AppError::Validation("invalid slug".into()));
            }
            active.slug = Set(v.clone());
        }
        if let Some(ref v) = body.logo_url {
            active.logo_url = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.description {
            active.description = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.contact_phone {
            active.contact_phone = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.contact_email {
            active.contact_email = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.accent_color {
            if !valid_hex_color(v) {
                return Err(AppError::Validation(
                    "accentColor must be #RRGGBB hex".into(),
                ));
            }
            active.accent_color = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.status {
            active.status = Set(v.clone());
        }
        if let Some(policy) = body.child_fare {
            let policy = policy.map(valid_child_fare).transpose()?;
            active.child_max_age = Set(policy.map(|p| p.max_age));
            active.child_discount_percent = Set(policy.map(|p| p.discount_percent));
        }

        active.updated_at = Set(now_iso());

        self.store
            .brand_store()
            .update_brand_full(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(AdminMutationResponse { id })
    }

    /// Delete a brand by id.
    pub async fn delete_brand(&self, id: Uuid) -> AppResult<AdminMutationResponse> {
        self.store
            .brand_store()
            .delete(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminMutationResponse { id })
    }
}

fn valid_child_fare(policy: ChildFarePolicy) -> AppResult<ChildFarePolicy> {
    if !(1..=MAX_CHILD_AGE).contains(&policy.max_age) {
        return Err(AppError::Validation(format!(
            "childFare.maxAge must be 1–{MAX_CHILD_AGE}"
        )));
    }
    if !(0..=100).contains(&policy.discount_percent) {
        return Err(AppError::Validation(
            "childFare.discountPercent must be 0–100".into(),
        ));
    }
    Ok(policy)
}
