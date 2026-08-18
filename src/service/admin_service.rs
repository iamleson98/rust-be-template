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
    AdminBookingDayBucket, AdminBookingDetail, AdminBookingDetailResponse,
    AdminBookingExportResponse, AdminBookingListResponse, AdminBookingOut, AdminBookingSeatOut,
    AdminBookingStatsResponse, AdminBookingStatusUpdate, AdminBookingTotals,
    AdminBrandListResponse, AdminBrandOut, AdminBusLayoutListResponse, AdminBusLayoutOut,
    AdminMutationResponse, AdminPickupPointListResponse, AdminPickupPointOut, AdminPlacePreview,
    AdminReviewListResponse, AdminRouteListResponse, AdminRouteOut, AdminScheduleListResponse,
    AdminScheduleOut, ModerateReviewRequest, ModerateReviewResponse, UpdateBookingStatusRequest,
    UpdateBookingStatusResponse, UpsertBrandRequest, UpsertPickupPointRequest, UpsertRouteRequest,
    UpsertScheduleRequest,
};
use crate::entity::{audit_log, booking, brand, pickup_point, review, route, schedule};
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

    /// List all routes with start/end place names and schedule/pickup counts.
    pub async fn list_routes(&self) -> AppResult<AdminRouteListResponse> {
        let routes = self.store.route_store().list_all_routes().await?;

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

        // Batched place lookups — replaces the N+1 of per-route
        // find_place_by_id(start) + find_place_by_id(end).
        let mut place_ids: Vec<Uuid> = Vec::new();
        for r in &routes {
            if let Some(id) = r.start_location_id.as_deref() {
                if let Ok(uid) = Uuid::parse_str(id) {
                    place_ids.push(uid);
                }
            }
            if let Some(id) = r.end_location_id.as_deref() {
                if let Ok(uid) = Uuid::parse_str(id) {
                    place_ids.push(uid);
                }
            }
        }
        place_ids.dedup();
        let places = self
            .store
            .place_store()
            .find_places_by_ids(place_ids)
            .await
            .unwrap_or_default();
        let place_map: std::collections::HashMap<Uuid, _> =
            places.into_iter().map(|p| (p.id, p)).collect();

        let mut items = Vec::with_capacity(routes.len());
        for r in &routes {
            let route_id_str = r.id.to_string();
            let schedule_count = *schedule_count_map.get(&route_id_str).unwrap_or(&0);
            let pickup_count = *pickup_count_map.get(&route_id_str).unwrap_or(&0);

            let start_place = r
                .start_location_id
                .as_deref()
                .and_then(|id| Uuid::parse_str(id).ok())
                .and_then(|uid| place_map.get(&uid))
                .map(|p| AdminPlacePreview {
                    id: p.id,
                    name: p.name.clone(),
                    province: p.province.clone(),
                });
            let end_place = r
                .end_location_id
                .as_deref()
                .and_then(|id| Uuid::parse_str(id).ok())
                .and_then(|uid| place_map.get(&uid))
                .map(|p| AdminPlacePreview {
                    id: p.id,
                    name: p.name.clone(),
                    province: p.province.clone(),
                });

            items.push(AdminRouteOut {
                id: r.id,
                brand_id: r.brand_id.clone(),
                name: r.name.clone(),
                start_location_id: r.start_location_id.clone(),
                end_location_id: r.end_location_id.clone(),
                distance_km: r.distance_km,
                duration_min: r.duration_min,
                status: r.status.clone(),
                created_at: r.created_at.clone(),
                updated_at: r.updated_at.clone(),
                start_location: start_place,
                end_location: end_place,
                schedule_count,
                pickup_point_count: pickup_count as i64,
            });
        }
        Ok(AdminRouteListResponse { items })
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
        let brand_id = body.brand_id.clone();
        let start_location_id = body.start_location_id.clone();
        let end_location_id = body.end_location_id.clone();

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = route::ActiveModel {
            id: Set(id),
            brand_id: Set(brand_id),
            name: Set(name),
            start_location_id: Set(start_location_id),
            end_location_id: Set(end_location_id),
            distance_km: Set(body.distance_km),
            duration_min: Set(body.duration_min.map(|n| n as i16)),
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
        if let Some(ref v) = body.brand_id {
            active.brand_id = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.start_location_id {
            active.start_location_id = Set(Some(v.clone()));
        }
        if let Some(ref v) = body.end_location_id {
            active.end_location_id = Set(Some(v.clone()));
        }
        if let Some(v) = body.distance_km {
            active.distance_km = Set(Some(v));
        }
        if let Some(v) = body.duration_min {
            active.duration_min = Set(Some(v as i16));
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

    // ── Schedules ───────────────────────────────────────────────

    /// List schedules for a route.
    pub async fn list_schedules(&self, route_id: &str) -> AppResult<AdminScheduleListResponse> {
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_route(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<AdminScheduleOut> = schedules
            .iter()
            .map(|s| AdminScheduleOut {
                id: s.id,
                route_id: s.route_id.clone(),
                departure_time: s.departure_time.clone(),
                effective_from: s.effective_from.clone(),
                effective_to: s.effective_to.clone(),
                days_of_week: s.days_of_week.clone(),
                bus_layout_id: s.bus_layout_id.clone(),
                base_price_adult: s.base_price_adult,
                base_price_child: s.base_price_child,
                amenities: s.amenities.clone(),
                created_at: s.created_at.clone(),
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
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?
            .to_string();
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

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = schedule::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            departure_time: Set(departure_time),
            effective_from: Set(body.effective_from.clone()),
            effective_to: Set(body.effective_to.clone()),
            days_of_week: Set(days_of_week),
            bus_layout_id: Set(body.bus_layout_id.clone()),
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

        let mut active: schedule::ActiveModel = existing.into();

        if let Some(ref v) = body.route_id {
            active.route_id = Set(v.clone());
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
        if let Some(ref v) = body.bus_layout_id {
            active.bus_layout_id = Set(Some(v.clone()));
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
                route_id: p.route_id.clone(),
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
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?
            .to_string();

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

    /// List all bus layouts.
    pub async fn list_bus_layouts(&self) -> AppResult<AdminBusLayoutListResponse> {
        let layouts = self
            .store
            .schedule_store()
            .list_bus_layouts()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<AdminBusLayoutOut> = layouts
            .iter()
            .map(|l| AdminBusLayoutOut {
                id: l.id,
                brand_id: l.brand_id.clone(),
                name: l.name.clone(),
                vehicle_type: l.vehicle_type.clone(),
                total_seats: l.total_seats,
                created_at: l.created_at.clone(),
                updated_at: l.updated_at.clone(),
            })
            .collect();
        Ok(AdminBusLayoutListResponse { items })
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
            total: None,
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
                seat_id: Some(bs.seat_id.clone()),
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
            target_id: Set(Some(id.to_string())),
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
