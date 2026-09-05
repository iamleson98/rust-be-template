//! Admin service — CRUD operations for brands, routes, schedules, pickup
//! points, reviews moderation, booking management, stats, and CSV export.
//!
//! Ported from `booking-rs/logic/admin.rs`, adapted to the template's
//! store + `AppError` architecture.
//!
//! ## Design
//! - Holds `Arc<CompositeStore>` for all DB access (BrandStore, RouteStore,
//!   ScheduleStore, ReviewStore, BookingStore, AuditStore, PlaceStore).
//! - All mutations validate input before hitting the DB.
//! - Admin-only methods require the caller to have an `admin` or `employee:admin`
//!   role (checked at the route layer via the `AdminUser` extractor).
//! - Returns typed DTOs from [`crate::dto::admin`] (no `serde_json::Value`).

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::Utc;
use sea_orm::Set;
use uuid::Uuid;

use crate::dto::admin::{
    AdminAddressListResponse, AdminAddressOut, AdminBookingDayBucket, AdminBookingDetail,
    AdminBookingDetailResponse, AdminBookingExportResponse, AdminBookingListResponse,
    AdminBookingOut, AdminBookingSeatOut, AdminBookingStatsResponse, AdminBookingStatusUpdate,
    AdminBookingTotals, AdminBrandListResponse, AdminBrandOut, AdminBusLayoutListResponse,
    AdminBusLayoutOut, AdminMutationResponse, AdminPickupPointListResponse, AdminPickupPointOut,
    AdminPlacePreview, AdminReviewListResponse, AdminRouteListResponse, AdminRouteOut,
    AdminScheduleListResponse, AdminScheduleOut, AdminSchedulePointOut,
    AdminVehicleTypeListResponse, AdminVehicleTypeOut, ModerateReviewRequest,
    ModerateReviewResponse, UpdateBookingStatusRequest, UpdateBookingStatusResponse,
    UpsertAddressRequest, UpsertBrandRequest, UpsertPickupPointRequest, UpsertRouteRequest,
    UpsertSchedulePointItem, UpsertScheduleRequest, UpsertVehicleTypeRequest,
};
use crate::entity::{
    address, audit_log, booking, brand, pickup_point, review, route, schedule, schedule_point,
    vehicle_type,
};
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

/// Admin service — pure business logic, no auth knowledge.
///
/// Permission checks are done at the route handler layer via
/// `require_permission(&st, &admin.0, rbac::ADMIN_BRANDS_WRITE).await?`.
pub struct AdminService {
    store: Arc<CompositeStore>,
}

impl AdminService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    // ── Brands ──────────────────────────────────────────────────

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
            .count_routes_by_brand_map(brand_id_strings.clone())
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
                total_trips: b.total_trips,
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
            rating: Set(body.rating),
            status: Set(body.status.clone().unwrap_or_else(|| "active".to_string())),
            accent_color: Set(accent_color),
            total_trips: Set(0),
            created_at: Set(now.clone()),
            updated_at: Set(now),
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
        if let Some(v) = body.rating {
            active.rating = Set(Some(v));
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

    // ── Routes ──────────────────────────────────────────────────

    /// List routes with start/end place names and schedule/pickup
    /// counts, with an optional brand filter + case-insensitive search
    /// and offset pagination (`limit=None` returns every matching row,
    /// matching the legacy "fetch all" behaviour for the schedule form).
    pub async fn list_routes(
        &self,
        brand_id: Option<&str>,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminRouteListResponse> {
        let limit = limit.map(|l| l.clamp(1, 200));
        let page = self
            .store
            .route_store()
            .list_routes_page(brand_id, q, limit, offset)
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

    // ── Addresses ───────────────────────────────────────────────

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

    // ── Schedules ───────────────────────────────────────────────

    /// List schedules for a route, including each schedule's ordered
    /// address points (batch-loaded — two extra queries total, no N+1).
    pub async fn list_schedules(&self, route_id: &str) -> AppResult<AdminScheduleListResponse> {
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_route(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if schedules.is_empty() {
            return Ok(AdminScheduleListResponse { items: Vec::new() });
        }

        let schedule_ids: Vec<Uuid> = schedules.iter().map(|s| s.id).collect();
        let points = self
            .store
            .address_store()
            .list_points_by_schedules(schedule_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let address_ids: Vec<Uuid> = points.iter().map(|p| p.address_id).collect();
        let addresses = self
            .store
            .address_store()
            .list_addresses_by_ids(address_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let address_map: std::collections::HashMap<Uuid, address::Model> =
            addresses.into_iter().map(|a| (a.id, a)).collect();

        // Batch-resolve the schedules' explicit vehicle classes (one
        // query for the whole page).
        let vehicle_type_ids: Vec<Uuid> =
            schedules.iter().filter_map(|s| s.vehicle_type_id).collect();
        let vehicle_type_map: std::collections::HashMap<Uuid, vehicle_type::Model> =
            if vehicle_type_ids.is_empty() {
                std::collections::HashMap::new()
            } else {
                self.store
                    .vehicle_type_store()
                    .find_vehicle_types_by_ids(vehicle_type_ids)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .into_iter()
                    .map(|v| (v.id, v))
                    .collect()
            };

        let items: Vec<AdminScheduleOut> = schedules
            .iter()
            .map(|s| {
                // `list_points_by_schedules` orders by stop_order; the
                // per-schedule filter keeps that ordering stable.
                let schedule_points: Vec<AdminSchedulePointOut> = points
                    .iter()
                    .filter(|p| p.schedule_id == s.id)
                    .filter_map(|p| {
                        address_map
                            .get(&p.address_id)
                            .map(|a| AdminSchedulePointOut {
                                id: p.id,
                                schedule_id: p.schedule_id,
                                address_id: p.address_id,
                                stop_order: p.stop_order,
                                kind: p.kind.clone(),
                                arrival_time: p.arrival_time.clone(),
                                address: address_out(a),
                            })
                    })
                    .collect();
                AdminScheduleOut {
                    id: s.id,
                    route_id: s.route_id,
                    departure_time: s.departure_time.clone(),
                    effective_from: s.effective_from.clone(),
                    effective_to: s.effective_to.clone(),
                    days_of_week: s.days_of_week.clone(),
                    bus_layout_id: s.bus_layout_id.clone(),
                    vehicle_type_id: s.vehicle_type_id.clone(),
                    vehicle_type: s
                        .vehicle_type_id
                        .as_ref()
                        .and_then(|id| vehicle_type_map.get(id))
                        .map(vehicle_type_out),
                    base_price_adult: s.base_price_adult,
                    base_price_child: s.base_price_child,
                    amenities: s.amenities.clone(),
                    points: schedule_points,
                    created_at: s.created_at.clone(),
                }
            })
            .collect();
        Ok(AdminScheduleListResponse { items })
    }

    /// Create a new schedule.
    pub async fn create_schedule(
        &self,
        body: &UpsertScheduleRequest,
    ) -> AppResult<AdminMutationResponse> {
        let route_id = body
            .route_id
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?;
        let departure_time = body
            .departure_time
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("departureTime is required".into()))?
            .to_string();

        if !regex_like_hhmm(&departure_time) {
            return Err(AppError::Validation(
                "departureTime must be HH:MM (00:00–23:59)".into(),
            ));
        }

        let days_of_week = body.days_of_week.clone();
        if let Some(ref d) = days_of_week {
            if !is_days_of_week(d) {
                return Err(AppError::Validation(
                    "daysOfWeek must be 7-char 0/1 bitmask".into(),
                ));
            }
        }

        // Validate the vehicle type reference BEFORE inserting so a bad
        // id can't wedge the FK (and reads as a friendly 4xx, not 500).
        if let Some(vt_id) = body.vehicle_type_id {
            self.ensure_vehicle_type_exists(vt_id).await?;
        }

        let id = Uuid::new_v4();
        // Validate the point sequence BEFORE inserting the schedule so a
        // rejected payload can't leave a half-configured schedule behind.
        let point_models = match &body.points {
            Some(items) => Some(self.build_schedule_points(route_id, id, items).await?),
            None => None,
        };

        let now = now_iso();
        let model = schedule::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            departure_time: Set(departure_time),
            effective_from: Set(body.effective_from.clone()),
            effective_to: Set(body.effective_to.clone()),
            days_of_week: Set(days_of_week),
            bus_layout_id: Set(body.bus_layout_id.clone()),
            vehicle_type_id: Set(body.vehicle_type_id),
            base_price_adult: Set(body.base_price_adult.unwrap_or(0)),
            base_price_child: Set(body.base_price_child),
            amenities: Set(body.amenities.clone()),
            created_at: Set(now),
        };

        self.store
            .schedule_store()
            .insert_schedule(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(models) = point_models {
            self.insert_points(models).await?;
        }

        Ok(AdminMutationResponse { id })
    }

    /// Update a schedule by id.
    pub async fn update_schedule(
        &self,
        id: Uuid,
        body: &UpsertScheduleRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .schedule_store()
            .find_schedule_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let original_route_id = existing.route_id;
        let mut active: schedule::ActiveModel = existing.into();

        // The (possibly updated) route scopes point validation — resolve it
        // before applying field updates.
        let final_route_id = body.route_id.unwrap_or(original_route_id);
        // Validate the new point sequence BEFORE mutating the schedule row.
        let point_models = match &body.points {
            Some(items) => Some(
                self.build_schedule_points(final_route_id, id, items)
                    .await?,
            ),
            None => None,
        };

        if let Some(v) = body.route_id {
            active.route_id = Set(v);
        }
        if let Some(ref v) = body.departure_time {
            if !regex_like_hhmm(v) {
                return Err(AppError::Validation("departureTime must be HH:MM".into()));
            }
            active.departure_time = Set(v.clone());
        }
        if let Some(ref v) = body.effective_from {
            active.effective_from = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.effective_to {
            active.effective_to = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.days_of_week {
            active.days_of_week = Set(Some(v.clone()));
        }
        if let Some(v) = body.bus_layout_id {
            active.bus_layout_id = Set(Some(v));
        }
        if let Some(v) = body.vehicle_type_id {
            self.ensure_vehicle_type_exists(v).await?;
            active.vehicle_type_id = Set(Some(v));
        }
        if let Some(v) = body.base_price_adult {
            active.base_price_adult = Set(v);
        }
        if let Some(v) = body.base_price_child {
            active.base_price_child = Set(Some(v));
        }
        if let Some(ref v) = body.amenities {
            active.amenities = Set(Some(v.clone()));
        }

        self.store
            .schedule_store()
            .update_schedule(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if let Some(models) = point_models {
            self.replace_points(id, models).await?;
        }

        Ok(AdminMutationResponse { id })
    }

    /// Delete a schedule by id.
    pub async fn delete_schedule(&self, id: Uuid) -> AppResult<()> {
        self.store
            .schedule_store()
            .delete_schedule(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    // ── Vehicle types ───────────────────────────────────────────

    /// List the vehicle-type catalog with optional label/code filter +
    /// offset pagination (the admin page + the schedule form's
    /// infinite-scroll picker).
    pub async fn list_vehicle_types(
        &self,
        q: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminVehicleTypeListResponse> {
        let limit = limit.map(|l| l.clamp(1, 200));
        let page = self
            .store
            .vehicle_type_store()
            .list_vehicle_types(q, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminVehicleTypeListResponse {
            items: page.items.iter().map(vehicle_type_out).collect(),
            total: page.total,
        })
    }

    /// Create a vehicle type. `code` is slugified (Vietnamese-aware) and
    /// must stay unique — the public search filter depends on it.
    pub async fn create_vehicle_type(
        &self,
        body: &UpsertVehicleTypeRequest,
    ) -> AppResult<AdminMutationResponse> {
        let label = optional_trimmed(body.label.as_deref())
            .ok_or_else(|| AppError::BadRequest("label is required".into()))?;
        let code = body
            .code
            .as_deref()
            .map(|s| slugify(s))
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("code is required".into()))?;
        if !valid_slug(&code) {
            return Err(AppError::Validation(
                "code must be lowercase letters, digits and dashes".into(),
            ));
        }
        let status = valid_vehicle_type_status(body.status.as_deref())
            .ok_or_else(|| AppError::Validation("status must be `active` or `disabled`".into()))?;

        // Duplicate guard (unique index also enforces it, but this gives
        // a 409 with a human message instead of a 500).
        if self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_code(&code)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .is_some()
        {
            return Err(AppError::Conflict(format!(
                "vehicle type code {code:?} already exists"
            )));
        }

        let id = Uuid::new_v4();
        let now = now_iso();
        self.store
            .vehicle_type_store()
            .insert_vehicle_type(vehicle_type::ActiveModel {
                id: Set(id),
                code: Set(code),
                label: Set(label),
                description: Set(optional_trimmed(body.description.as_deref())),
                total_seats: Set(body.total_seats),
                sort_order: Set(body.sort_order.unwrap_or(0)),
                status: Set(status.to_string()),
                created_at: Set(now.clone()),
                updated_at: Set(now),
            })
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminMutationResponse { id })
    }

    /// Update a vehicle type (patch semantics — only provided fields).
    pub async fn update_vehicle_type(
        &self,
        id: Uuid,
        body: &UpsertVehicleTypeRequest,
    ) -> AppResult<AdminMutationResponse> {
        let existing = self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("vehicle type not found".into()))?;

        let original_code = existing.code.clone();
        let mut active: vehicle_type::ActiveModel = existing.into();

        if let Some(ref code) = body.code {
            let code = slugify(code);
            if !valid_slug(&code) {
                return Err(AppError::Validation(
                    "code must be lowercase letters, digits and dashes".into(),
                ));
            }
            // Uniqueness when the code actually changes.
            if !code.eq_ignore_ascii_case(&original_code) {
                if let Some(dup) = self
                    .store
                    .vehicle_type_store()
                    .find_vehicle_type_by_code(&code)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                {
                    if dup.id != id {
                        return Err(AppError::Conflict(format!(
                            "vehicle type code {code:?} already exists"
                        )));
                    }
                }
            }
            active.code = Set(code);
        }
        if let Some(ref label) = body.label {
            let label = label.trim().to_string();
            if label.is_empty() {
                return Err(AppError::Validation("label cannot be empty".into()));
            }
            active.label = Set(label);
        }
        if let Some(ref desc) = body.description {
            // Patch semantics: `""` clears, non-empty sets the trimmed text.
            active.description = Set(optional_trimmed(Some(desc.as_str())));
        }
        if let Some(seats) = body.total_seats {
            active.total_seats = Set(Some(seats));
        }
        if let Some(sort) = body.sort_order {
            active.sort_order = Set(sort);
        }
        if let Some(ref status) = body.status {
            let status = valid_vehicle_type_status(Some(status)).ok_or_else(|| {
                AppError::Validation("status must be `active` or `disabled`".into())
            })?;
            active.status = Set(status.to_string());
        }
        active.updated_at = Set(now_iso());

        self.store
            .vehicle_type_store()
            .update_vehicle_type(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(AdminMutationResponse { id })
    }

    /// Delete a vehicle type. Referencing schedules fall back to their
    /// bus layout (`ON DELETE SET NULL` semantics) — the reference is
    /// cleared explicitly in one transaction so SQLite (no FK on the
    /// added column) behaves exactly like Postgres.
    pub async fn delete_vehicle_type(&self, id: Uuid) -> AppResult<()> {
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};

        let txn = self
            .store
            .db()
            .begin()
            .await
            .map_err(|e| AppError::Internal(format!("begin txn: {e}")))?;
        schedule::Entity::update_many()
            .col_expr(
                schedule::Column::VehicleTypeId,
                sea_orm::sea_query::Expr::value(Option::<Uuid>::None),
            )
            .filter(schedule::Column::VehicleTypeId.eq(id))
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("clear schedule references: {e}")))?;
        vehicle_type::Entity::delete_by_id(id)
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("delete vehicle type: {e}")))?;
        txn.commit()
            .await
            .map_err(|e| AppError::Internal(format!("commit txn: {e}")))?;
        Ok(())
    }

    // ── Pickup Points ───────────────────────────────────────────

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

    // ── Reviews moderation ──────────────────────────────────────

    /// List reviews with admin filters (status, brand, route).
    pub async fn list_reviews(
        &self,
        status: Option<&str>,
        brand_id: Option<&str>,
        route_id: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> AppResult<AdminReviewListResponse> {
        let limit = limit.min(200);
        let reviews = self
            .store
            .review_store()
            .list_reviews(brand_id, route_id, None, status, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<crate::dto::review::ReviewOut> = reviews
            .iter()
            .map(crate::service::review_service::review_to_dto)
            .collect();
        Ok(AdminReviewListResponse { items })
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

        Ok(ModerateReviewResponse {
            id,
            status: updated.status,
        })
    }

    // ── Bus Layouts ─────────────────────────────────────────────

    /// List bus layouts with an optional brand filter and offset
    /// pagination (`limit=None` returns every matching row — the
    /// schedule form's seat-map picker relies on that).
    pub async fn list_bus_layouts(
        &self,
        brand_id: Option<&str>,
        limit: Option<u64>,
        offset: u64,
    ) -> AppResult<AdminBusLayoutListResponse> {
        let limit = limit.map(|l| l.clamp(1, 200));
        let page = self
            .store
            .schedule_store()
            .list_bus_layouts_page(brand_id, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let layouts = page.items;

        let items: Vec<AdminBusLayoutOut> = layouts
            .iter()
            .map(|l| AdminBusLayoutOut {
                id: l.id,
                brand_id: l.brand_id,
                name: l.name.clone(),
                vehicle_type: l.vehicle_type.clone(),
                total_seats: l.total_seats,
                created_at: l.created_at.clone(),
                updated_at: l.updated_at.clone(),
            })
            .collect();
        Ok(AdminBusLayoutListResponse {
            items,
            total: Some(page.total),
        })
    }

    // ── Booking management ──────────────────────────────────────

    /// List bookings with admin filters.
    #[allow(clippy::too_many_arguments)]
    pub async fn list_bookings(
        &self,
        status: Option<&str>,
        _brand_id: Option<&str>,
        _route_id: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
        _search: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> AppResult<AdminBookingListResponse> {
        let limit = limit.min(200);
        // Total matching-row count (independent of the window) — the
        // admin tickets table needs it to render "Hiển thị X–Y / N" and
        // to enable the next/previous page buttons.
        let total = self
            .store
            .booking_store()
            .count_bookings_by_status(status)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Note: brand_id, route_id, date_from, date_to, search filters are
        // not supported by the current BookingStore trait; only status is.
        // For full admin filtering, the store trait would need extension.
        let bookings = self
            .store
            .booking_store()
            .list_bookings_by_status(status, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Previously: `let total = bookings.len();` — that's the page size
        // (capped by `limit`), NOT the matching-row count, so pagination
        // showed "Showing 1-50 of 50" on every page. Now omit `total` from
        // the response until the store gets a proper count_bookings_by_filter
        // method (tracked separately).
        let items: Vec<AdminBookingOut> = bookings
            .iter()
            .map(|b| AdminBookingOut {
                id: b.id,
                code: b.code.clone(),
                status: b.status.clone(),
                total: b.total,
                currency: b.currency.clone(),
                contact_name: b.contact_name.clone(),
                contact_phone: b.contact_phone.clone(),
                contact_email: b.contact_email.clone(),
                payment_method: b.payment_method.clone(),
                pickup_name: b.pickup_name.clone(),
                dropoff_name: b.dropoff_name.clone(),
                created_at: b.created_at.clone(),
                updated_at: b.updated_at.clone(),
                expires_at: b.expires_at.clone(),
            })
            .collect();

        Ok(AdminBookingListResponse {
            items,
            total: Some(total),
            limit,
            offset,
        })
    }

    /// Get a single booking by id (admin view with full detail).
    pub async fn get_booking(&self, id: Uuid) -> AppResult<AdminBookingDetailResponse> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // Fetch booking seats
        let seats = self
            .store
            .booking_store()
            .list_booking_seats(&b.id.to_string())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let seats_out: Vec<AdminBookingSeatOut> = seats
            .iter()
            .map(|bs| AdminBookingSeatOut {
                seat_id: Some(bs.seat_id.to_string()),
                price: bs.price,
                passenger_name: bs.passenger_name.clone(),
                passenger_type: bs.passenger_type.clone(),
                passenger_age: bs.passenger_age,
            })
            .collect();

        Ok(AdminBookingDetailResponse {
            item: AdminBookingDetail {
                id: b.id,
                code: b.code,
                status: b.status,
                subtotal: b.subtotal,
                discount: b.discount,
                fees: b.fees,
                total: b.total,
                currency: b.currency,
                contact_name: b.contact_name,
                contact_phone: b.contact_phone,
                contact_email: b.contact_email,
                payment_method: b.payment_method,
                pickup_name: b.pickup_name,
                dropoff_name: b.dropoff_name,
                created_at: b.created_at,
                updated_at: b.updated_at,
                expires_at: b.expires_at,
                seats: seats_out,
            },
        })
    }

    /// Update booking status (admin override with state machine validation).
    pub async fn update_booking_status(
        &self,
        id: Uuid,
        body: &UpdateBookingStatusRequest,
    ) -> AppResult<UpdateBookingStatusResponse> {
        let new_status = body.status.as_str();
        let valid = [
            "pending",
            "confirmed",
            "paid",
            "completed",
            "cancelled",
            "refunded",
        ];
        if !valid.contains(&new_status) {
            return Err(AppError::BadRequest("invalid booking status".into()));
        }

        // Normalize paid → confirmed
        let canonical = if new_status == "paid" {
            "confirmed".to_string()
        } else if new_status == "refunded" {
            "cancelled".to_string()
        } else {
            new_status.to_string()
        };

        let existing = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if existing.status == canonical {
            return Ok(UpdateBookingStatusResponse {
                item: AdminBookingStatusUpdate {
                    id,
                    status: existing.status,
                    previous_status: Some(new_status.to_string()),
                    updated_at: existing.updated_at.clone(),
                },
                reason: body.reason.clone(),
            });
        }

        // Validate the transition
        if !body.force {
            let allowed = matches!(
                (existing.status.as_str(), canonical.as_str()),
                ("pending", "confirmed")
                    | ("pending", "cancelled")
                    | ("confirmed", "completed")
                    | ("confirmed", "cancelled")
                    | ("completed", "cancelled")
                    | ("refunded", "cancelled")
                    | ("cancelled", "refunded")
            );
            if !allowed {
                return Err(AppError::BadRequest(format!(
                    "cannot transition from '{}' to '{}'. Use force=true for admin override.",
                    existing.status, canonical
                )));
            }
        }

        let now = now_iso();
        let mut active: booking::ActiveModel = existing.into();
        active.status = Set(canonical.clone());
        active.updated_at = Set(now.clone());
        self.store
            .booking_store()
            .update_booking(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Audit log (best-effort)
        let audit_id = Uuid::new_v4();
        let audit_model = audit_log::ActiveModel {
            id: Set(audit_id),
            action: Set(format!("booking_status_{canonical}")),
            target_type: Set(Some("booking".to_string())),
            target_id: Set(Some(id)),
            metadata: Set(body.reason.clone()),
            ..Default::default()
        };
        let _ = self.store.audit_store().insert_audit_log(audit_model).await;

        Ok(UpdateBookingStatusResponse {
            item: AdminBookingStatusUpdate {
                id,
                status: canonical,
                previous_status: Some(new_status.to_string()),
                updated_at: now,
            },
            reason: body.reason.clone(),
        })
    }

    /// Compute booking stats (totals, by-day, by-brand breakdowns).
    pub async fn booking_stats(
        &self,
        status: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
    ) -> AppResult<AdminBookingStatsResponse> {
        // SQL-side aggregation — replaces the previous "load ALL bookings
        // into memory and iterate in Rust" pattern that would OOM at scale.
        // Two queries: one for status totals, one for per-day breakdown.
        use crate::entity::booking;
        use sea_orm::sea_query::Expr;
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};

        // ── Status totals: SELECT status, COUNT(*), SUM(total) GROUP BY status
        let mut totals_q = booking::Entity::find().select_only();
        totals_q = totals_q
            .column(booking::Column::Status)
            .column_as(Expr::col(booking::Column::Id).count(), "count")
            .column_as(Expr::col(booking::Column::Total).sum(), "revenue")
            .group_by(booking::Column::Status);
        if let Some(s) = status {
            if s != "all" {
                totals_q = totals_q.filter(booking::Column::Status.eq(s.to_string()));
            }
        }
        let totals_rows: Vec<(String, i64, Option<i64>)> = totals_q
            .into_tuple::<(String, i64, Option<i64>)>()
            .all(self.store.db())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut total = 0i64;
        let mut revenue = 0i64;
        let mut confirmed = 0i64;
        let mut cancelled = 0i64;
        let mut completed = 0i64;
        let mut pending = 0i64;
        for (st, count, rev) in &totals_rows {
            total += count;
            revenue += rev.unwrap_or(0);
            match st.as_str() {
                "confirmed" | "paid" => confirmed += count,
                "cancelled" => cancelled += count,
                "completed" => completed += count,
                _ => pending += count,
            }
        }

        // ── Per-day breakdown: fetch only created_at + status + total
        // (3 columns instead of the full row) and aggregate in Rust.
        // At 10k+ bookings this is ~3x smaller payload than loading full
        // rows. A proper SQL GROUP BY DATE(created_at) would be even
        // better but requires dialect-specific SUBSTR/DATE handling.
        let mut day_q = booking::Entity::find()
            .select_only()
            .column(booking::Column::CreatedAt)
            .column(booking::Column::Status)
            .column(booking::Column::Total);
        if let Some(s) = status {
            if s != "all" {
                day_q = day_q.filter(booking::Column::Status.eq(s.to_string()));
            }
        }
        let day_rows: Vec<(String, String, Option<i64>)> = day_q
            .into_tuple::<(String, String, Option<i64>)>()
            .all(self.store.db())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut by_day: BTreeMap<String, DayBucket> = BTreeMap::new();
        for (created_at, st, total_val) in &day_rows {
            let day = created_at.get(..10).unwrap_or("").to_string();
            if day.is_empty() {
                continue;
            }
            let entry = by_day.entry(day).or_default();
            entry.count += 1;
            entry.revenue += total_val.unwrap_or(0);
            match st.as_str() {
                "confirmed" | "paid" => entry.confirmed += 1,
                "cancelled" => entry.cancelled += 1,
                "completed" => entry.completed += 1,
                _ => entry.pending += 1,
            }
        }

        let by_day_vec: Vec<AdminBookingDayBucket> = by_day
            .iter()
            .map(|(day, b)| AdminBookingDayBucket {
                date: day.clone(),
                count: b.count,
                revenue: b.revenue,
                confirmed: b.confirmed,
                cancelled: b.cancelled,
                completed: b.completed,
                pending: b.pending,
            })
            .collect();

        Ok(AdminBookingStatsResponse {
            totals: AdminBookingTotals {
                total,
                revenue,
                confirmed,
                cancelled,
                completed,
                pending,
            },
            by_day: by_day_vec,
        })
    }

    /// Export bookings as CSV.
    ///
    /// Uses streaming pagination (1000 rows per page) to avoid loading
    /// the entire booking table into memory at once. At 100k bookings
    /// the previous approach would use ~50MB of RAM per export request.
    pub async fn booking_export(
        &self,
        status: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
        columns: Option<&str>,
    ) -> AppResult<AdminBookingExportResponse> {
        let col_list: Vec<String> = columns
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            })
            .unwrap_or_else(|| {
                [
                    "code",
                    "status",
                    "contactName",
                    "contactPhone",
                    "total",
                    "paymentMethod",
                    "createdAt",
                ]
                .iter()
                .map(|s| s.to_string())
                .collect()
            });

        // CSV with UTF-8 BOM (Excel-friendly)
        let mut csv = String::from('\u{feff}');
        csv.push_str(&col_list.join(","));
        csv.push('\n');

        let mut total_count = 0usize;
        let mut offset = 0u64;
        const PAGE: u64 = 1000;
        loop {
            let bookings = self
                .store
                .booking_store()
                .list_bookings_by_status(status, PAGE, offset)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if bookings.is_empty() {
                break;
            }
            for b in &bookings {
                let mut row: Vec<String> = Vec::with_capacity(col_list.len());
                for col in &col_list {
                    let val: String = match col.as_str() {
                        "code" => b.code.clone(),
                        "status" => b.status.clone(),
                        "contactName" => b.contact_name.clone().unwrap_or_default(),
                        "contactPhone" => b.contact_phone.clone().unwrap_or_default(),
                        "total" => b.total.to_string(),
                        "paymentMethod" => b.payment_method.clone().unwrap_or_default(),
                        "createdAt" => b.created_at.clone(),
                        _ => String::new(),
                    };
                    row.push(format!("\"{}\"", val.replace('"', "\"\"")));
                }
                csv.push_str(&row.join(","));
                csv.push('\n');
            }
            total_count += bookings.len();
            offset += PAGE;
            if (bookings.len() as u64) < PAGE {
                break;
            }
        }

        Ok(AdminBookingExportResponse {
            csv,
            count: total_count,
            columns: col_list,
            filename: format!("bookings_export_{}.csv", Utc::now().format("%Y%m%d_%H%M%S")),
        })
    }
}

// ────────────────────────────────────────────────────────────────
//  Validation helpers (ported from booking-rs)
// ────────────────────────────────────────────────────────────────

/// Vietnamese-aware slugify: strips diacritics, lowercases, replaces
/// non-alphanumeric runs with a single `-`.
pub fn slugify(input: &str) -> String {
    fn strip_diacritic(c: char) -> char {
        match c {
            'á' | 'à' | 'ả' | 'ã' | 'ạ' | 'â' | 'ầ' | 'ẩ' | 'ẫ' | 'ậ' | 'ă' | 'ằ' | 'ẳ' | 'ẵ'
            | 'ặ' => 'a',
            'Á' | 'À' | 'Ả' | 'Ã' | 'Ạ' | 'Â' | 'Ầ' | 'Ẩ' | 'Ẫ' | 'Ậ' | 'Ă' | 'Ằ' | 'Ẳ' | 'Ẵ'
            | 'Ặ' => 'a',
            'é' | 'è' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ể' | 'ễ' | 'ệ' => 'e',
            'É' | 'È' | 'Ẻ' | 'Ẽ' | 'Ẹ' | 'Ê' | 'Ề' | 'Ể' | 'Ễ' | 'Ệ' => 'e',
            'í' | 'ì' | 'ỉ' | 'ĩ' | 'ị' => 'i',
            'Í' | 'Ì' | 'Ỉ' | 'Ĩ' | 'Ị' => 'i',
            'ó' | 'ò' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ờ' | 'ở' | 'ỡ'
            | 'ợ' => 'o',
            'Ó' | 'Ò' | 'Ỏ' | 'Õ' | 'Ọ' | 'Ô' | 'Ồ' | 'Ổ' | 'Ỗ' | 'Ộ' | 'Ơ' | 'Ờ' | 'Ở' | 'Ỡ'
            | 'Ợ' => 'o',
            'ú' | 'ù' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ử' | 'ữ' | 'ự' => 'u',
            'Ú' | 'Ù' | 'Ủ' | 'Ũ' | 'Ụ' | 'Ư' | 'Ừ' | 'Ử' | 'Ữ' | 'Ự' => 'u',
            'ý' | 'ỳ' | 'ỷ' | 'ỹ' | 'ỵ' => 'y',
            'Ý' | 'Ỳ' | 'Ỷ' | 'Ỹ' | 'Ỵ' => 'y',
            'đ' => 'd',
            'Đ' => 'd',
            _ => c,
        }
    }
    let s: String = input.chars().map(strip_diacritic).collect();
    let s = s.to_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = true; // suppress leading dashes
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// `#RRGGBB` hex color validator.
pub fn valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s.as_bytes()[1..7].iter().all(|b| b.is_ascii_hexdigit())
}

/// Validate a slug (lowercase alphanumeric + dashes).
pub fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}

/// `HH:MM` time validator (00:00 – 23:59).
pub fn regex_like_hhmm(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b':'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
        && (b[0] - b'0') * 10 + (b[1] - b'0') <= 23
        && (b[3] - b'0') * 10 + (b[4] - b'0') <= 59
}

/// `YYYY-MM-DD` date validator.
pub fn is_ymd(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[0..4].iter().all(|c| c.is_ascii_digit())
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}

/// 7-char `0`/`1` days-of-week bitmask validator.
pub fn is_days_of_week(s: &str) -> bool {
    s.len() == 7 && s.bytes().all(|c| c == b'0' || c == b'1')
}

// ────────────────────────────────────────────────────────────────
//  Schedule-point helpers
// ────────────────────────────────────────────────────────────────

impl AdminService {
    /// A schedule's `vehicleType` reference must point at a real catalog
    /// row. Validated on create/update so a bad id reads as a friendly
    /// 4xx instead of an FK 500 (and to keep SQLite — no FK on the added
    /// column — consistent with Postgres).
    async fn ensure_vehicle_type_exists(&self, id: Uuid) -> AppResult<()> {
        if self
            .store
            .vehicle_type_store()
            .find_vehicle_type_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .is_none()
        {
            return Err(AppError::NotFound(format!(
                "vehicle type {id} does not exist"
            )));
        }
        Ok(())
    }

    /// Validate + build the ordered `schedule_point` rows for a schedule.
    ///
    /// Rules:
    /// - at least 2 entries (departure + destination),
    /// - every entry references an existing address,
    /// - every address belongs to the route's brand (points are
    ///   brand-scoped so one brand can never build a route out of
    ///   another brand's stops),
    /// - `kind` derives from position (first `pickup`, last `drop`,
    ///   otherwise `middle`) and `stop_order` equals the array index.
    async fn build_schedule_points(
        &self,
        route_id: Uuid,
        schedule_id: Uuid,
        items: &[UpsertSchedulePointItem],
    ) -> AppResult<Vec<schedule_point::ActiveModel>> {
        if items.len() < 2 {
            return Err(AppError::Validation(
                "points must contain at least the departure and destination addresses (2 items)"
                    .into(),
            ));
        }

        // The route's brand scopes which addresses may be used.
        let route_model = self
            .store
            .route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;
        let brand_id = route_model.brand_id.ok_or_else(|| {
            AppError::Validation(
                "route has no brand — assign a brand to the route before configuring points".into(),
            )
        })?;

        let address_ids: Option<Vec<Uuid>> = items.iter().map(|p| p.address_id).collect();
        let address_ids = address_ids
            .ok_or_else(|| AppError::Validation("every point must reference an address".into()))?;

        let addresses = self
            .store
            .address_store()
            .list_addresses_by_ids(address_ids.clone())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Dedupe before the existence check — `IN (...)` returns one row
        // per address, so a repeated address in the sequence (legal,
        // e.g. circular routes) must not look like a missing one.
        let distinct_ids: std::collections::HashSet<Uuid> = address_ids.iter().copied().collect();
        if addresses.len() != distinct_ids.len() {
            return Err(AppError::Validation(
                "one or more point addresses do not exist".into(),
            ));
        }
        for a in &addresses {
            if a.brand_id != brand_id {
                return Err(AppError::Validation(
                    "point addresses must belong to the route's brand".into(),
                ));
            }
        }

        // Arrival times are optional but must be `HH:MM` when present
        // (same vocabulary as `departure_time`).
        for (i, p) in items.iter().enumerate() {
            if let Some(t) = p.arrival_time.as_deref() {
                let t = t.trim();
                if !t.is_empty() && !regex_like_hhmm(t) {
                    return Err(AppError::Validation(format!(
                        "points[{i}].arrivalTime must be HH:MM (00:00-23:59)"
                    )));
                }
            }
        }

        let now = now_iso();
        let total = items.len();
        Ok(items
            .iter()
            .enumerate()
            .map(|(index, p)| schedule_point::ActiveModel {
                id: Set(Uuid::new_v4()),
                schedule_id: Set(schedule_id),
                address_id: Set(p.address_id.expect("checked above")),
                stop_order: Set(index as i64),
                kind: Set(point_kind(index, total).to_string()),
                arrival_time: Set(optional_trimmed(p.arrival_time.as_deref())),
                created_at: Set(now.clone()),
            })
            .collect())
    }

    /// Insert freshly built points inside a single transaction.
    async fn insert_points(&self, models: Vec<schedule_point::ActiveModel>) -> AppResult<()> {
        if models.is_empty() {
            return Ok(());
        }
        use sea_orm::{DatabaseTransaction, EntityTrait, TransactionTrait};
        let txn: DatabaseTransaction = self
            .store
            .db()
            .begin()
            .await
            .map_err(|e| AppError::Internal(format!("begin txn: {e}")))?;
        schedule_point::Entity::insert_many(models)
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("insert points: {e}")))?;
        txn.commit()
            .await
            .map_err(|e| AppError::Internal(format!("commit txn: {e}")))?;
        Ok(())
    }

    /// Atomically replace a schedule's whole point sequence
    /// (delete-then-insert in one transaction).
    async fn replace_points(
        &self,
        schedule_id: Uuid,
        models: Vec<schedule_point::ActiveModel>,
    ) -> AppResult<()> {
        use sea_orm::{
            ColumnTrait, DatabaseTransaction, EntityTrait, QueryFilter, TransactionTrait,
        };
        let txn: DatabaseTransaction = self
            .store
            .db()
            .begin()
            .await
            .map_err(|e| AppError::Internal(format!("begin txn: {e}")))?;
        schedule_point::Entity::delete_many()
            .filter(schedule_point::Column::ScheduleId.eq(schedule_id))
            .exec(&txn)
            .await
            .map_err(|e| AppError::Internal(format!("delete points: {e}")))?;
        if !models.is_empty() {
            schedule_point::Entity::insert_many(models)
                .exec(&txn)
                .await
                .map_err(|e| AppError::Internal(format!("insert points: {e}")))?;
        }
        txn.commit()
            .await
            .map_err(|e| AppError::Internal(format!("commit txn: {e}")))?;
        Ok(())
    }
}

/// Map a `vehicle_type` row to its admin DTO.
fn vehicle_type_out(v: &vehicle_type::Model) -> AdminVehicleTypeOut {
    AdminVehicleTypeOut {
        id: v.id,
        code: v.code.clone(),
        label: v.label.clone(),
        description: v.description.clone(),
        total_seats: v.total_seats,
        sort_order: v.sort_order,
        status: v.status.clone(),
        created_at: v.created_at.clone(),
        updated_at: v.updated_at.clone(),
    }
}

/// `active` | `disabled` (catalog status vocabulary).
fn valid_vehicle_type_status(s: Option<&str>) -> Option<&'static str> {
    match s.unwrap_or("active") {
        "active" => Some("active"),
        "disabled" => Some("disabled"),
        _ => None,
    }
}

/// Point kind derived from its position in the sequence.
fn point_kind(index: usize, total: usize) -> &'static str {
    if index == 0 {
        "pickup"
    } else if index + 1 == total {
        "drop"
    } else {
        "middle"
    }
}

/// Map an `address::Model` to its wire DTO.
fn address_out(a: &address::Model) -> AdminAddressOut {
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

/// Trim + drop empty optional strings (`""` → `None`).
fn optional_trimmed(v: Option<&str>) -> Option<String> {
    v.map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Current UTC time as ISO 8601 string.
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ────────────────────────────────────────────────────────────────
//  Stats helpers
// ────────────────────────────────────────────────────────────────

#[derive(Default)]
struct DayBucket {
    count: i64,
    revenue: i64,
    confirmed: i64,
    cancelled: i64,
    completed: i64,
    pending: i64,
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_ascii_lowercases() {
        assert_eq!(slugify("Hello World"), "hello-world");
    }
    #[test]
    fn slugify_strips_vietnamese_diacritics() {
        assert_eq!(slugify("Hà Nội"), "ha-noi");
        assert_eq!(slugify("Đà Nẵng"), "da-nang");
    }
    #[test]
    fn slugify_trims_trailing_dashes() {
        assert_eq!(slugify("hello!!!"), "hello");
    }

    #[test]
    fn valid_hex_color_accepts_6_digit() {
        assert!(valid_hex_color("#1a2b3c"));
        assert!(valid_hex_color("#FFFFFF"));
    }
    #[test]
    fn valid_hex_color_rejects_short() {
        assert!(!valid_hex_color("#fff"));
        assert!(!valid_hex_color("1a2b3c"));
        assert!(!valid_hex_color("#gggggg"));
    }

    #[test]
    fn valid_slug_accepts_simple() {
        assert!(valid_slug("phuong-trang"));
        assert!(valid_slug("abc123"));
    }
    #[test]
    fn valid_slug_rejects_edge_cases() {
        assert!(!valid_slug(""));
        assert!(!valid_slug("-leading"));
        assert!(!valid_slug("trailing-"));
        assert!(!valid_slug("Upper"));
    }

    #[test]
    fn regex_like_hhmm_accepts_valid() {
        assert!(regex_like_hhmm("00:00"));
        assert!(regex_like_hhmm("08:30"));
        assert!(regex_like_hhmm("23:59"));
    }
    #[test]
    fn regex_like_hhmm_rejects_invalid() {
        assert!(!regex_like_hhmm("24:00"));
        assert!(!regex_like_hhmm("12:60"));
        assert!(!regex_like_hhmm("abc"));
        assert!(!regex_like_hhmm("1:30"));
    }

    #[test]
    fn is_ymd_accepts_valid_dates() {
        assert!(is_ymd("2026-08-16"));
        assert!(is_ymd("2026-12-31"));
    }
    #[test]
    fn is_ymd_rejects_malformed() {
        assert!(!is_ymd("2026-8-16"));
        assert!(!is_ymd("20260816"));
        assert!(!is_ymd("2026/08/16"));
    }

    #[test]
    fn is_days_of_week_accepts_7_chars() {
        assert!(is_days_of_week("1111111"));
        assert!(is_days_of_week("1010101"));
    }
    #[test]
    fn is_days_of_week_rejects_other_lengths() {
        assert!(!is_days_of_week("111111"));
        assert!(!is_days_of_week("11111111"));
        assert!(!is_days_of_week("2020111"));
    }
}
