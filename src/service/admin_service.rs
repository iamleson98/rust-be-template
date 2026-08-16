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
//!   role (checked via `require_admin`).

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::Utc;
use sea_orm::Set;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::entity::{
    audit_log, booking, brand, pickup_point, review,
    route, schedule,
};
use crate::error::{AppError, AppResult};
use crate::rbac::RbacChecker;
use crate::store::CompositeStore;

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct AdminService {
    store: Arc<CompositeStore>,
    rbac: Arc<RbacChecker>,
}

impl AdminService {
    pub fn new(
        store: Arc<CompositeStore>,
        rbac: Arc<RbacChecker>,
    ) -> Self {
        Self { store, rbac }
    }

    // ── Role guard ──────────────────────────────────────────────

    /// Ensure the caller is an admin (employee with admin role).
    /// Returns `AppError::Forbidden` if not.
    pub fn require_admin(_caller_id: Uuid, role: &str, actor_type: &str) -> AppResult<()> {
        if actor_type == "employee" && role == "admin" {
            Ok(())
        } else {
            Err(AppError::Forbidden("admin access required".into()))
        }
    }

    // ── Brands ──────────────────────────────────────────────────

    /// List all brands with route/layout counts.
    pub async fn list_brands(&self) -> AppResult<Value> {
        let brands = self.store.brand_store()
            .list_all(1000, 0)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut items = Vec::with_capacity(brands.len());
        for b in &brands {
            let route_count = self.store.route_store()
                .count_routes_by_brand(&b.id.to_string())
                .await
                .unwrap_or(0);
            let layout_count = self.store.schedule_store()
                .count_bus_layouts_by_brand(&b.id.to_string())
                .await
                .unwrap_or(0);
            items.push(json!({
                "id": b.id,
                "slug": b.slug,
                "name": b.name,
                "logoUrl": b.logo_url,
                "description": b.description,
                "contactPhone": b.contact_phone,
                "contactEmail": b.contact_email,
                "rating": b.rating,
                "status": b.status,
                "accentColor": b.accent_color,
                "totalTrips": b.total_trips,
                "createdAt": b.created_at,
                "updatedAt": b.updated_at,
                "routeCount": route_count,
                "layoutCount": layout_count,
            }));
        }
        Ok(json!({ "items": items }))
    }

    /// Create a new brand.
    pub async fn create_brand(&self, body: &Value) -> AppResult<Value> {
        let name = non_empty_str_field(body, "name")
            .ok_or_else(|| AppError::BadRequest("name is required".into()))?
            .to_string();
        let slug = non_empty_str_field(body, "slug")
            .map(|s| s.to_string())
            .unwrap_or_else(|| slugify(&name));

        if !valid_slug(&slug) {
            return Err(AppError::Validation(
                "slug must be lowercase alphanumeric + dashes".into(),
            ));
        }

        let accent_color = body
            .get("accentColor")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
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
            logo_url: Set(opt_str_field(body, "logoUrl")),
            description: Set(opt_str_field(body, "description")),
            contact_phone: Set(opt_str_field(body, "contactPhone")),
            contact_email: Set(opt_str_field(body, "contactEmail")),
            rating: Set(body.get("rating").and_then(|v| v.as_f64())),
            status: Set(non_empty_str_field(body, "status")
                .unwrap_or("active")
                .to_string()),
            accent_color: Set(accent_color),
            total_trips: Set(0),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };

        self.store.brand_store()
            .insert_brand(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    /// Update a brand by id.
    pub async fn update_brand(&self, id: Uuid, body: &Value) -> AppResult<Value> {
        let existing = self.store.brand_store()
            .get_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("brand not found".into()))?;

        let mut active: brand::ActiveModel = existing.into();

        if let Some(Some(v)) = opt_string_field(body, "name") {
            active.name = Set(v);
        }
        if let Some(opt) = opt_string_field(body, "slug") {
            if let Some(v) = opt {
                if !valid_slug(&v) {
                    return Err(AppError::Validation("invalid slug".into()));
                }
                active.slug = Set(v);
            }
        }
        if let Some(opt) = opt_string_field(body, "logoUrl") {
            active.logo_url = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "description") {
            active.description = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "contactPhone") {
            active.contact_phone = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "contactEmail") {
            active.contact_email = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "accentColor") {
            if let Some(ref c) = opt {
                if !valid_hex_color(c) {
                    return Err(AppError::Validation("accentColor must be #RRGGBB hex".into()));
                }
            }
            active.accent_color = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "status") {
            active.status = Set(opt.unwrap_or_else(|| "active".to_string()));
        }
        if let Some(v) = body.get("rating") {
            active.rating = Set(v.as_f64());
        }

        active.updated_at = Set(now_iso());

        self.store.brand_store()
            .update_brand_full(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    // ── Routes ──────────────────────────────────────────────────

    /// List all routes with start/end place names and schedule/pickup counts.
    pub async fn list_routes(&self) -> AppResult<Value> {
        let routes = self.store.route_store()
            .list_all_routes()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut items = Vec::with_capacity(routes.len());
        for r in &routes {
            let schedule_count = self.store.schedule_store()
                .list_schedules_by_route(&r.id.to_string())
                .await
                .map(|v| v.len())
                .unwrap_or(0);
            let pickup_count = self.store.route_store()
                .count_pickup_points_by_route(&r.id.to_string())
                .await
                .unwrap_or(0);

            let start_place = if let Some(id) = r.start_location_id.as_deref() {
                if let Ok(uid) = Uuid::parse_str(id) {
                    self.store.place_store()
                        .find_place_by_id(uid)
                        .await
                        .ok()
                        .flatten()
                } else {
                    None
                }
            } else {
                None
            };
            let end_place = if let Some(id) = r.end_location_id.as_deref() {
                if let Ok(uid) = Uuid::parse_str(id) {
                    self.store.place_store()
                        .find_place_by_id(uid)
                        .await
                        .ok()
                        .flatten()
                } else {
                    None
                }
            } else {
                None
            };

            items.push(json!({
                "id": r.id,
                "brandId": r.brand_id,
                "name": r.name,
                "startLocationId": r.start_location_id,
                "endLocationId": r.end_location_id,
                "distanceKm": r.distance_km,
                "durationMin": r.duration_min,
                "status": r.status,
                "createdAt": r.created_at,
                "updatedAt": r.updated_at,
                "startLocation": start_place.map(|p| json!({
                    "id": p.id,
                    "name": p.name,
                    "province": p.province,
                })),
                "endLocation": end_place.map(|p| json!({
                    "id": p.id,
                    "name": p.name,
                    "province": p.province,
                })),
                "scheduleCount": schedule_count,
                "pickupPointCount": pickup_count,
            }));
        }
        Ok(json!({ "items": items }))
    }

    /// Create a new route.
    pub async fn create_route(&self, body: &Value) -> AppResult<Value> {
        let name = non_empty_str_field(body, "name")
            .ok_or_else(|| AppError::BadRequest("name is required".into()))?
            .to_string();
        let brand_id = opt_str_field(body, "brandId");
        let start_location_id = opt_str_field(body, "startLocationId");
        let end_location_id = opt_str_field(body, "endLocationId");

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = route::ActiveModel {
            id: Set(id),
            brand_id: Set(brand_id),
            name: Set(name),
            start_location_id: Set(start_location_id),
            end_location_id: Set(end_location_id),
            distance_km: Set(body.get("distanceKm").and_then(|v| v.as_f64())),
            duration_min: Set(body.get("durationMin").and_then(|v| v.as_i64()).map(|n| n as i16)),
            status: Set(non_empty_str_field(body, "status")
                .unwrap_or("active")
                .to_string()),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        };

        self.store.route_store()
            .insert_route(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    /// Update a route by id.
    pub async fn update_route(&self, id: Uuid, body: &Value) -> AppResult<Value> {
        let existing = self.store.route_store()
            .find_route_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        let mut active: route::ActiveModel = existing.into();

        if let Some(Some(v)) = opt_string_field(body, "name") {
            active.name = Set(v);
        }
        if let Some(opt) = opt_string_field(body, "brandId") {
            active.brand_id = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "startLocationId") {
            active.start_location_id = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "endLocationId") {
            active.end_location_id = Set(opt);
        }
        if let Some(v) = body.get("distanceKm") {
            active.distance_km = Set(v.as_f64());
        }
        if let Some(v) = body.get("durationMin") {
            active.duration_min = Set(v.as_i64().map(|n| n as i16));
        }
        if let Some(opt) = opt_string_field(body, "status") {
            active.status = Set(opt.unwrap_or_else(|| "active".to_string()));
        }

        active.updated_at = Set(now_iso());

        self.store.route_store()
            .update_route(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    // ── Schedules ───────────────────────────────────────────────

    /// List schedules for a route.
    pub async fn list_schedules(&self, route_id: &str) -> AppResult<Value> {
        let schedules = self.store.schedule_store()
            .list_schedules_by_route(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<Value> = schedules
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "routeId": s.route_id,
                    "departureTime": s.departure_time,
                    "effectiveFrom": s.effective_from,
                    "effectiveTo": s.effective_to,
                    "daysOfWeek": s.days_of_week,
                    "busLayoutId": s.bus_layout_id,
                    "basePriceAdult": s.base_price_adult,
                    "basePriceChild": s.base_price_child,
                    "amenities": s.amenities,
                    "createdAt": s.created_at,
                })
            })
            .collect();
        Ok(json!({ "items": items }))
    }

    /// Create a new schedule.
    pub async fn create_schedule(&self, body: &Value) -> AppResult<Value> {
        let route_id = non_empty_str_field(body, "routeId")
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?
            .to_string();
        let departure_time = non_empty_str_field(body, "departureTime")
            .ok_or_else(|| AppError::BadRequest("departureTime is required".into()))?
            .to_string();

        if !regex_like_hhmm(&departure_time) {
            return Err(AppError::Validation(
                "departureTime must be HH:MM (00:00–23:59)".into(),
            ));
        }

        let days_of_week = opt_str_field(body, "daysOfWeek");
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
            effective_from: Set(opt_str_field(body, "effectiveFrom")),
            effective_to: Set(opt_str_field(body, "effectiveTo")),
            days_of_week: Set(days_of_week),
            bus_layout_id: Set(opt_str_field(body, "busLayoutId")),
            base_price_adult: Set(body.get("basePriceAdult").and_then(|v| v.as_i64()).unwrap_or(0)),
            base_price_child: Set(body.get("basePriceChild").and_then(|v| v.as_i64())),
            amenities: Set(opt_str_field(body, "amenities")),
            created_at: Set(now),
        };

        self.store.schedule_store()
            .insert_schedule(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    /// Update a schedule by id.
    pub async fn update_schedule(&self, id: Uuid, body: &Value) -> AppResult<Value> {
        let existing = self.store.schedule_store()
            .find_schedule_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let mut active: schedule::ActiveModel = existing.into();

        if let Some(Some(v)) = opt_string_field(body, "routeId") {
            active.route_id = Set(v);
        }
        if let Some(Some(v)) = opt_string_field(body, "departureTime") {
            if !regex_like_hhmm(&v) {
                return Err(AppError::Validation("departureTime must be HH:MM".into()));
            }
            active.departure_time = Set(v);
        }
        if let Some(opt) = opt_string_field(body, "effectiveFrom") {
            active.effective_from = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "effectiveTo") {
            active.effective_to = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "daysOfWeek") {
            active.days_of_week = Set(opt);
        }
        if let Some(opt) = opt_string_field(body, "busLayoutId") {
            active.bus_layout_id = Set(opt);
        }
        if let Some(v) = body.get("basePriceAdult") {
            active.base_price_adult = Set(v.as_i64().unwrap_or(0));
        }
        if let Some(v) = body.get("basePriceChild") {
            active.base_price_child = Set(v.as_i64());
        }
        if let Some(opt) = opt_string_field(body, "amenities") {
            active.amenities = Set(opt);
        }

        self.store.schedule_store()
            .update_schedule(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    /// Delete a schedule by id.
    pub async fn delete_schedule(&self, id: Uuid) -> AppResult<()> {
        self.store.schedule_store()
            .delete_schedule(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(())
    }

    // ── Pickup Points ───────────────────────────────────────────

    /// List pickup points for a route.
    pub async fn list_pickup_points(&self, route_id: &str) -> AppResult<Value> {
        let points = self.store.route_store()
            .list_pickup_points_by_route(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<Value> = points
            .iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "routeId": p.route_id,
                    "name": p.name,
                    "address": p.address,
                    "lat": p.lat,
                    "lon": p.lon,
                    "stopOrder": p.stop_order,
                    "kind": p.kind,
                    "createdAt": p.created_at,
                })
            })
            .collect();
        Ok(json!({ "items": items }))
    }

    /// Create a new pickup point.
    pub async fn create_pickup_point(&self, body: &Value) -> AppResult<Value> {
        let route_id = non_empty_str_field(body, "routeId")
            .ok_or_else(|| AppError::BadRequest("routeId is required".into()))?
            .to_string();

        let id = Uuid::new_v4();
        let now = now_iso();
        let model = pickup_point::ActiveModel {
            id: Set(id),
            route_id: Set(route_id),
            name: Set(opt_str_field(body, "name")),
            address: Set(opt_str_field(body, "address")),
            lat: Set(body.get("lat").and_then(|v| v.as_f64())),
            lon: Set(body.get("lon").and_then(|v| v.as_f64())),
            stop_order: Set(body.get("stopOrder").and_then(|v| v.as_i64()).unwrap_or(0)),
            kind: Set(opt_str_field(body, "kind")),
            created_at: Set(now),
        };

        self.store.route_store()
            .insert_pickup_point(model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    /// Update a pickup point by id.
    pub async fn update_pickup_point(&self, id: Uuid, body: &Value) -> AppResult<Value> {
        let existing = self.store.route_store()
            .find_pickup_point_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("pickup point not found".into()))?;

        let mut active: pickup_point::ActiveModel = existing.into();

        if let Some(Some(v)) = opt_string_field(body, "name") {
            active.name = Set(Some(v));
        }
        if let Some(opt) = opt_string_field(body, "address") {
            active.address = Set(opt);
        }
        if let Some(v) = body.get("lat") {
            active.lat = Set(v.as_f64());
        }
        if let Some(v) = body.get("lon") {
            active.lon = Set(v.as_f64());
        }
        if let Some(v) = body.get("stopOrder") {
            active.stop_order = Set(v.as_i64().unwrap_or(0));
        }
        if let Some(opt) = opt_string_field(body, "kind") {
            active.kind = Set(opt);
        }

        self.store.route_store()
            .update_pickup_point(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id }))
    }

    /// Delete a pickup point by id.
    pub async fn delete_pickup_point(&self, id: Uuid) -> AppResult<()> {
        self.store.route_store()
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
    ) -> AppResult<Value> {
        let limit = limit.min(200);
        let reviews = self.store.review_store()
            .list_reviews(
                brand_id,
                route_id,
                None,
                status,
                limit,
                offset,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<Value> = reviews.iter().map(review_to_json).collect();
        Ok(json!({ "items": items }))
    }

    /// Update review status (approve / reject / hide).
    pub async fn update_review_status(
        &self,
        id: Uuid,
        status: &str,
        reply: Option<&str>,
    ) -> AppResult<Value> {
        let valid = ["pending", "approved", "rejected", "hidden"];
        if !valid.contains(&status) {
            return Err(AppError::BadRequest(format!(
                "invalid status: {status}"
            )));
        }

        let existing = self.store.review_store()
            .find_review_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("review not found".into()))?;

        let mut active: review::ActiveModel = existing.into();
        active.status = Set(status.to_string());
        if let Some(r) = reply {
            active.reply = Set(Some(r.to_string()));
            active.replied_at = Set(Some(now_iso()));
        }
        active.updated_at = Set(now_iso());

        self.store.review_store()
            .update_review(active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({ "id": id, "status": status }))
    }

    // ── Bus Layouts ─────────────────────────────────────────────

    /// List all bus layouts.
    pub async fn list_bus_layouts(&self) -> AppResult<Value> {
        let layouts = self.store.schedule_store()
            .list_bus_layouts()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<Value> = layouts
            .iter()
            .map(|l| {
                json!({
                    "id": l.id,
                    "brandId": l.brand_id,
                    "name": l.name,
                    "vehicleType": l.vehicle_type,
                    "totalSeats": l.total_seats,
                    "createdAt": l.created_at,
                    "updatedAt": l.updated_at,
                })
            })
            .collect();
        Ok(json!({ "items": items }))
    }

    // ── Booking management ──────────────────────────────────────

    /// List bookings with admin filters.
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
    ) -> AppResult<Value> {
        let limit = limit.min(200);
        // Note: brand_id, route_id, date_from, date_to, search filters are
        // not supported by the current BookingStore trait; only status is.
        // For full admin filtering, the store trait would need extension.
        let bookings = self.store.booking_store()
            .list_bookings_by_status(status, limit, offset)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<Value> = bookings
            .iter()
            .map(|b| {
                json!({
                    "id": b.id,
                    "code": b.code,
                    "status": b.status,
                    "total": b.total,
                    "currency": b.currency,
                    "contactName": b.contact_name,
                    "contactPhone": b.contact_phone,
                    "contactEmail": b.contact_email,
                    "paymentMethod": b.payment_method,
                    "pickupName": b.pickup_name,
                    "dropoffName": b.dropoff_name,
                    "createdAt": b.created_at,
                    "updatedAt": b.updated_at,
                    "expiresAt": b.expires_at,
                })
            })
            .collect();

        Ok(json!({ "items": items }))
    }

    /// Get a single booking by id (admin view with full detail).
    pub async fn get_booking(&self, id: Uuid) -> AppResult<Value> {
        let b = self.store.booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // Fetch booking seats
        let seats = self.store.booking_store()
            .list_booking_seats(&b.id.to_string())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let seats_json: Vec<Value> = seats
            .iter()
            .map(|bs| {
                json!({
                    "seatId": bs.seat_id,
                    "price": bs.price,
                    "passengerName": bs.passenger_name,
                    "passengerType": bs.passenger_type,
                    "passengerAge": bs.passenger_age,
                })
            })
            .collect();

        Ok(json!({
            "id": b.id,
            "code": b.code,
            "status": b.status,
            "subtotal": b.subtotal,
            "discount": b.discount,
            "fees": b.fees,
            "total": b.total,
            "currency": b.currency,
            "contactName": b.contact_name,
            "contactPhone": b.contact_phone,
            "contactEmail": b.contact_email,
            "paymentMethod": b.payment_method,
            "pickupName": b.pickup_name,
            "dropoffName": b.dropoff_name,
            "createdAt": b.created_at,
            "updatedAt": b.updated_at,
            "expiresAt": b.expires_at,
            "seats": seats_json,
        }))
    }

    /// Update booking status (admin override with state machine validation).
    pub async fn update_booking_status(
        &self,
        id: Uuid,
        new_status: &str,
        reason: Option<&str>,
        force: bool,
    ) -> AppResult<Value> {
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

        let existing = self.store.booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if existing.status == canonical {
            return Ok(json!({
                "item": { "id": id, "status": existing.status },
                "noChange": true,
            }));
        }

        // Validate the transition
        if !force {
            let allowed = match (existing.status.as_str(), canonical.as_str()) {
                ("pending", "confirmed") | ("pending", "cancelled") => true,
                ("confirmed", "completed") | ("confirmed", "cancelled") => true,
                ("completed", "cancelled") | ("refunded", "cancelled") => true,
                ("cancelled", "refunded") => true,
                _ => false,
            };
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
        self.store.booking_store()
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
            metadata: Set(reason.map(|r| r.to_string())),
            ..Default::default()
        };
        let _ = self.store.audit_store()
            .insert_audit_log(audit_model)
            .await;

        Ok(json!({
            "item": {
                "id": id,
                "status": canonical,
                "previousStatus": new_status,
                "updatedAt": now,
            },
            "reason": reason,
        }))
    }

    /// Compute booking stats (totals, by-day, by-brand breakdowns).
    pub async fn booking_stats(
        &self,
        status: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
    ) -> AppResult<Value> {
        let bookings = self.store.booking_store()
            .list_all_bookings_by_status(status)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let total = bookings.len() as i64;
        let mut revenue: i64 = 0;
        let mut confirmed = 0i64;
        let mut cancelled = 0i64;
        let mut completed = 0i64;
        let mut pending = 0i64;

        for b in &bookings {
            match b.status.as_str() {
                "confirmed" | "paid" => {
                    confirmed += 1;
                    revenue += b.total as i64;
                }
                "cancelled" => cancelled += 1,
                "completed" => {
                    completed += 1;
                    revenue += b.total as i64;
                }
                _ => pending += 1,
            }
        }

        // Per-day breakdown
        let mut by_day: BTreeMap<String, DayBucket> = BTreeMap::new();
        for b in &bookings {
            let day = b.created_at.get(..10).unwrap_or("").to_string();
            if day.is_empty() {
                continue;
            }
            let entry = by_day.entry(day).or_default();
            entry.count += 1;
            entry.revenue += b.total as i64;
            match b.status.as_str() {
                "confirmed" | "paid" => entry.confirmed += 1,
                "cancelled" => entry.cancelled += 1,
                "completed" => entry.completed += 1,
                _ => entry.pending += 1,
            }
        }

        let by_day_json: Vec<Value> = by_day
            .iter()
            .map(|(day, b)| {
                json!({
                    "date": day,
                    "count": b.count,
                    "revenue": b.revenue,
                    "confirmed": b.confirmed,
                    "cancelled": b.cancelled,
                    "completed": b.completed,
                    "pending": b.pending,
                })
            })
            .collect();

        Ok(json!({
            "totals": {
                "total": total,
                "revenue": revenue,
                "confirmed": confirmed,
                "cancelled": cancelled,
                "completed": completed,
                "pending": pending,
            },
            "byDay": by_day_json,
        }))
    }

    /// Export bookings as CSV.
    pub async fn booking_export(
        &self,
        status: Option<&str>,
        _date_from: Option<&str>,
        _date_to: Option<&str>,
        columns: Option<&str>,
    ) -> AppResult<Value> {
        let bookings = self.store.booking_store()
            .list_all_bookings_by_status(status)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let col_list: Vec<String> = columns
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            })
            .unwrap_or_else(|| {
                [
                    "code", "status", "contactName", "contactPhone", "total",
                    "paymentMethod", "createdAt",
                ]
                .iter()
                .map(|s| s.to_string())
                .collect()
            });

        // CSV with UTF-8 BOM (Excel-friendly)
        let mut csv = String::from('\u{feff}');
        csv.push_str(&col_list.join(","));
        csv.push('\n');

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

        Ok(json!({
            "csv": csv,
            "count": bookings.len(),
            "columns": col_list,
            "filename": format!("bookings_export_{}.csv", Utc::now().format("%Y%m%d_%H%M%S")),
        }))
    }
}

// ────────────────────────────────────────────────────────────────
//  Serialization helpers
// ────────────────────────────────────────────────────────────────

fn review_to_json(r: &review::Model) -> Value {
    let tags: Vec<&str> = r
        .tags
        .as_deref()
        .unwrap_or("")
        .split(',')
        .filter(|s| !s.is_empty())
        .collect();
    json!({
        "id": r.id,
        "rating": r.rating,
        "title": r.title,
        "content": r.content,
        "tags": tags,
        "authorName": r.author_name,
        "authorPhone": r.author_phone,
        "status": r.status,
        "helpfulCount": r.helpful_count,
        "reply": r.reply,
        "repliedAt": r.replied_at,
        "createdAt": r.created_at,
        "updatedAt": r.updated_at,
        "brandId": r.brand_id,
        "routeId": r.route_id,
    })
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
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
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

// ── JSON value field extractors ──

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn non_empty_str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    str_field(v, key).map(|s| s.trim()).filter(|s| !s.is_empty())
}

fn opt_str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| match x {
        Value::Null => None,
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    })
}

/// `serde_json::Value` → `Option<Option<String>>` — returns `None` when the
/// field is absent (caller treats as "not in patch"), `Some(None)` when
/// present but null/empty.
fn opt_string_field(v: &Value, key: &str) -> Option<Option<String>> {
    if !v.as_object().map(|o| o.contains_key(key)).unwrap_or(false) {
        return None;
    }
    let val = v.get(key);
    let out = match val {
        None | Some(Value::Null) => None,
        Some(s) if s.is_string() => {
            let trimmed = s.as_str().unwrap_or("").trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    };
    Some(out)
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
    use serde_json::json;

    #[test]
    fn slugify_ascii_lowercases() {
        assert_eq!(slugify("Hello World"), "hello-world");
    }
    #[test]
    fn slugify_strips_vietnamese_diacritics() {
        assert_eq!(slugify("Hà Nội"), "ha-noi");
    }
    #[test]
    fn slugify_strips_special_chars() {
        assert_eq!(slugify("Foo! Bar? #Baz"), "foo-bar-baz");
    }
    #[test]
    fn slugify_collapses_runs_of_separators() {
        assert_eq!(slugify("a---b   c"), "a-b-c");
    }
    #[test]
    fn slugify_no_leading_or_trailing_dashes() {
        assert_eq!(slugify("---hello---"), "hello");
    }
    #[test]
    fn slugify_empty_returns_empty() {
        assert_eq!(slugify(""), "");
    }
    #[test]
    fn slugify_d_is_d() {
        assert_eq!(slugify("Đà Nẵng"), "da-nang");
    }

    #[test]
    fn hex_color_valid() {
        assert!(valid_hex_color("#0d9488"));
        assert!(valid_hex_color("#ABCDEF"));
    }
    #[test]
    fn hex_color_invalid_missing_hash() {
        assert!(!valid_hex_color("0d9488"));
    }
    #[test]
    fn hex_color_invalid_short() {
        assert!(!valid_hex_color("#abc"));
    }

    #[test]
    fn hhmm_valid() {
        assert!(regex_like_hhmm("08:30"));
        assert!(regex_like_hhmm("23:59"));
        assert!(regex_like_hhmm("00:00"));
    }
    #[test]
    fn hhmm_invalid_hour_out_of_range() {
        assert!(!regex_like_hhmm("24:00"));
    }
    #[test]
    fn hhmm_invalid_minute_out_of_range() {
        assert!(!regex_like_hhmm("12:60"));
    }

    #[test]
    fn ymd_valid() {
        assert!(is_ymd("2024-01-15"));
    }
    #[test]
    fn ymd_invalid_slash_separator() {
        assert!(!is_ymd("2024/01/15"));
    }

    #[test]
    fn days_of_week_valid() {
        assert!(is_days_of_week("1111111"));
        assert!(is_days_of_week("1010100"));
    }
    #[test]
    fn days_of_week_invalid_short() {
        assert!(!is_days_of_week("111111"));
    }

    #[test]
    fn valid_slug_ok() {
        assert!(valid_slug("hello-world"));
        assert!(valid_slug("abc123"));
    }
    #[test]
    fn valid_slug_rejects_uppercase() {
        assert!(!valid_slug("Hello"));
    }
    #[test]
    fn valid_slug_rejects_leading_dash() {
        assert!(!valid_slug("-hello"));
    }

    #[test]
    fn opt_string_field_absent_returns_none_outer() {
        let v = json!({ "a": 1 });
        assert_eq!(opt_string_field(&v, "missing"), None);
    }
    #[test]
    fn opt_string_field_null_returns_some_none() {
        let v = json!({ "name": null });
        assert_eq!(opt_string_field(&v, "name"), Some(None));
    }
    #[test]
    fn opt_string_field_non_empty_returns_some_some() {
        let v = json!({ "name": "abc" });
        assert_eq!(opt_string_field(&v, "name"), Some(Some("abc".to_string())));
    }
}
