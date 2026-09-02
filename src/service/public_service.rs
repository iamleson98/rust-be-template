//! Public service — read-only business logic for the home page + search.
//!
//! Ported from `booking-rs/logic/public.rs`, adapted to the template's
//! store + `AppError` architecture.
//!
//! ## Design
//! - Uses `CompositeStore` for all DB access (BrandStore, RouteStore,
//!   ScheduleStore, TripStore, PlaceStore).
//! - Returns typed DTOs from [`crate::dto::public`] (no `serde_json::Value`).
//! - Pure helpers (vehicle_type_label, parse_amenities, etc.) are ported as-is.

use std::collections::BTreeMap;
use std::sync::Arc;

use uuid::Uuid;

use crate::dto::public::{
    BrandDetailOut, BrandListResponse, BrandOut, CampaignListResponse, CampaignOut,
    CampaignValidateResponse, RouteBrandPreview, RouteEndpoint, RouteListResponse, RouteOut,
    StatsResponse, TripAmenity, TripBrandDetail, TripBusLayout, TripCampaign, TripCore, TripDetail,
    TripEndpoint, TripPickupPoint, TripPricing, TripResult, TripRouteDetail, TripSearchResponse,
    TripSeat, TripSeatDeck, TripSeatMap, TripSeatRow,
};
use crate::entity::{brand, bus_layout, route, schedule, seat_inventory};
use crate::error::{AppError, AppResult};
use crate::store::PickupPointWithRoute;
use crate::store::CompositeStore;
use crate::service::place_service::haversine_km;

// ────────────────────────────────────────────────────────────────
//  Pure helpers
// ────────────────────────────────────────────────────────────────

/// Vietnamese label for a vehicle type.
fn vehicle_type_label(vt: &str) -> &'static str {
    match vt {
        "limousine" => "Limousine",
        "sleeper" => "Giường nằm",
        "semi_sleeper" | "semi-sleeper" => "Giường nằm đơn",
        "minivan" => "Minivan",
        "standard" => "Ghế ngồi",
        _ => "Ghế ngồi",
    }
}

/// Parse a Schedule.amenities JSON string into a `Vec<String>`.
fn parse_amenities(raw: &Option<String>) -> Vec<String> {
    match raw {
        None => Vec::new(),
        Some(s) if s.trim().is_empty() => Vec::new(),
        Some(s) => {
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(s) {
                return arr;
            }
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        }
    }
}

/// Compute the ISO departure timestamp from date + time.
///
/// Returns `(Some(dep_iso), None)` — arrival is no longer computed here
/// since the route entity no longer carries a `duration_min`. Callers
/// that need an arrival estimate should derive it from a Valhalla
/// directions request between the route's start/end points.
fn compute_iso_timestamps(
    departure_date: &Option<String>,
    departure_time: &Option<String>,
) -> (Option<String>, Option<String>) {
    let date = match departure_date {
        Some(d) if !d.is_empty() => d.clone(),
        _ => return (None, None),
    };
    let (date_only, time_part) = if let Some(idx) = date.find('T') {
        (date[..idx].to_string(), &date[idx + 1..])
    } else {
        (date.clone(), "")
    };
    let dep_time = departure_time
        .as_deref()
        .filter(|t| !t.is_empty())
        .unwrap_or(time_part);
    if dep_time.is_empty() {
        return (None, None);
    }
    let dep_iso = format!("{}T{}:00", date_only, dep_time);
    (Some(dep_iso), None)
}

/// Amenity key → Vietnamese label.
fn amenity_label(key: &str) -> &'static str {
    match key {
        "wifi" => "WiFi",
        "ac" => "Điều hòa",
        "water" => "Nước uống",
        "charging" => "Cắm sạc",
        "blanket" => "Chăn mền",
        _ => "",
    }
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct PublicService {
    store: Arc<CompositeStore>,
}

impl PublicService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    // ── Brands ──────────────────────────────────────────────────

    /// List active brands (slim DTO for the homepage grid).
    pub async fn list_brands(&self, limit: u64) -> AppResult<BrandListResponse> {
        let limit = limit.clamp(1, 500);
        let brands = self
            .store
            .brand_store()
            .list_active(limit)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<BrandOut> = brands
            .iter()
            .map(|b| BrandOut {
                id: b.id,
                slug: b.slug.clone(),
                name: b.name.clone(),
                logo_url: b.logo_url.clone(),
                accent_color: b.accent_color.clone(),
                rating: b.rating,
                total_trips: b.total_trips,
            })
            .collect();
        Ok(BrandListResponse { items })
    }

    /// Brand detail by slug.
    pub async fn brand_detail(&self, slug: &str) -> AppResult<BrandDetailOut> {
        let b = self
            .store
            .brand_store()
            .get_by_slug(slug)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .filter(|b| b.status == "active")
            .ok_or_else(|| AppError::NotFound("brand not found".into()))?;

        Ok(BrandDetailOut {
            id: b.id,
            slug: b.slug,
            name: b.name,
            logo_url: b.logo_url,
            description: b.description,
            contact_phone: b.contact_phone,
            contact_email: b.contact_email,
            accent_color: b.accent_color,
            rating: b.rating,
            total_trips: b.total_trips,
        })
    }

    // ── Routes ──────────────────────────────────────────────────

    /// List routes, optionally filtered by brand.
    pub async fn list_routes(
        &self,
        brand_id: Option<&str>,
        limit: u64,
    ) -> AppResult<RouteListResponse> {
        let limit = limit.clamp(1, 500);
        // Note: BrandStore.list_routes_by_status doesn't support brand_id filter.
        // If brand_id is provided, use list_routes_by_brand; otherwise list_routes_by_status.
        let routes = if let Some(bid) = brand_id {
            self.store
                .route_store()
                .list_routes_by_brand(bid)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        } else {
            self.store
                .route_store()
                .list_routes_by_status("active", limit)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        };
        let routes: Vec<_> = routes
            .into_iter()
            .filter(|r| r.status == "active")
            .take(limit as usize)
            .collect();

        // Batch fetch brands
        let brand_uuids: Vec<Uuid> = routes.iter().filter_map(|r| r.brand_id).collect();
        let brands: std::collections::HashMap<Uuid, brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id, b))
            .collect();

        // Batch fetch schedule counts
        let route_ids: Vec<String> = routes.iter().map(|r| r.id.to_string()).collect();
        let route_uuids: Vec<Uuid> = route_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut schedule_count: std::collections::HashMap<Uuid, usize> =
            std::collections::HashMap::new();
        for s in &schedules {
            *schedule_count.entry(s.route_id).or_insert(0) += 1;
        }

        let items: Vec<RouteOut> = routes
            .iter()
            .map(|r| {
                let brand = r.brand_id.and_then(|bid| brands.get(&bid));
                let (from_name, to_name) = r
                    .name
                    .split_once(" → ")
                    .map(|(f, t)| (f.to_string(), t.to_string()))
                    .unwrap_or_else(|| (r.name.clone(), String::new()));

                RouteOut {
                    id: r.id,
                    brand_id: r.brand_id,
                    name: r.name.clone(),
                    brand: RouteBrandPreview {
                        name: brand.map(|b| b.name.clone()),
                        slug: brand.map(|b| b.slug.clone()),
                        accent_color: brand.and_then(|b| b.accent_color.clone()),
                        logo_url: brand.and_then(|b| b.logo_url.clone()),
                        rating: brand.and_then(|b| b.rating),
                    },
                    from: RouteEndpoint {
                        name: from_name,
                        lat: 0.0,
                        lon: 0.0,
                    },
                    to: RouteEndpoint {
                        name: to_name,
                        lat: 0.0,
                        lon: 0.0,
                    },
                    schedule_count: schedule_count.get(&r.id).copied().unwrap_or(0),
                }
            })
            .collect();
        Ok(RouteListResponse { items })
    }

    // ── Trips ───────────────────────────────────────────────────

    /// Search trips by from/to/date with optional vehicle-type filter.
    ///
    /// This is a simplified version that uses SeaORM queries instead of
    /// the raw SQL JOIN in booking-rs. It searches by place names and date.
    #[allow(clippy::too_many_arguments)]
    pub async fn search_trips(
        &self,
        from: &str,
        to: &str,
        date: &str,
        limit: u64,
        vehicle_types: Vec<String>,
        sort: &str,
        min_seats: i64,
    ) -> AppResult<TripSearchResponse> {
        let from = from.trim();
        let to = to.trim();
        let date = date.trim();
        if from.is_empty() {
            return Err(AppError::BadRequest(
                "missing departure location (from)".into(),
            ));
        }
        if to.is_empty() {
            return Err(AppError::BadRequest("missing arrival location (to)".into()));
        }
        if date.is_empty() {
            return Err(AppError::BadRequest("missing departure date".into()));
        }
        let limit = limit.clamp(1, 100);
        let _sort = if sort.is_empty() { "departure" } else { sort };
        let min_seats = min_seats.max(1);

        // SQL-side route search — replaces the previous "load 1000 routes
        // and filter with to_lowercase().contains() in Rust" pattern.
        // The SQL LOWER(name) LIKE '%from%' AND LOWER(name) LIKE '%to%'
        // does the filtering server-side, returning only matching routes.
        let from_lower = from.to_lowercase();
        let to_lower = to.to_lowercase();
        let matching_routes = self
            .store
            .route_store()
            .search_active_routes_by_name(&from_lower, &to_lower, 1000)
            .await?;

        if matching_routes.is_empty() {
            return Ok(TripSearchResponse { items: Vec::new() });
        }

        let route_ids: Vec<String> = matching_routes.iter().map(|r| r.id.to_string()).collect();
        let route_uuids: Vec<Uuid> = route_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();

        // Find schedules for these routes
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let schedule_ids: Vec<String> = schedules.iter().map(|s| s.id.to_string()).collect();
        let schedule_uuids: Vec<Uuid> = schedule_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();

        // Find trip sessions for these schedules on the given date
        let trips = self
            .store
            .trip_store()
            .list_trips_by_schedule_ids(schedule_uuids, date, min_seats, limit)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Batch fetch related data
        let trip_sched_uuids: Vec<Uuid> = trips.iter().map(|t| t.schedule_id).collect();
        let sched_map: std::collections::HashMap<String, schedule::Model> = self
            .store
            .schedule_store()
            .list_schedules_by_ids(trip_sched_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|s| (s.id.to_string(), s))
            .collect();

        let sched_route_uuids: Vec<Uuid> = sched_map.values().map(|s| s.route_id).collect();
        let route_map: std::collections::HashMap<String, route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(sched_route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|r| (r.id.to_string(), r))
            .collect();

        let route_brand_uuids: Vec<Uuid> = route_map.values().filter_map(|r| r.brand_id).collect();
        let brand_map: std::collections::HashMap<String, brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(route_brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id.to_string(), b))
            .collect();

        // Fetch bus layouts for vehicle type filtering. `bus_layout_id`
        // is `Uuid` on the schedule entity — collect directly (the old
        // String→Uuid parse workaround is gone with the type fix).
        let bus_layout_uuids: Vec<Uuid> = sched_map
            .values()
            .filter_map(|s| s.bus_layout_id)
            .collect();
        let layout_map: std::collections::HashMap<String, bus_layout::Model> = {
            // No batch method on ScheduleStore for IDs; fetch one-by-one (small N)
            let mut m = std::collections::HashMap::new();
            for uid in bus_layout_uuids {
                if let Ok(Some(l)) = self.store.schedule_store().find_bus_layout_by_id(uid).await {
                    m.insert(l.id.to_string(), l);
                }
            }
            m
        };

        // Resolve start/end location slugs to city records via the
        // hardcoded city table (no DB round-trip). Replaces the previous
        // batched `place_store().find_places_by_ids(place_uuids)` lookup
        // — `route.start_location_id` is now a slug string, not a UUID
        // FK to `place`. We collect into a HashMap so the per-trip
        // closure can do `O(1)` lookups by slug. Both columns are NOT
        // NULL, so we always have a slug to look up — `find_by_slug`
        // returns `None` only if the slug doesn't match any hardcoded
        // city (data corruption case).
        let place_map: std::collections::HashMap<&str, &crate::cities::City> = route_map
            .values()
            .flat_map(|r| [r.start_location_id.as_str(), r.end_location_id.as_str()])
            .filter_map(|slug| crate::cities::find_by_slug(slug).map(|c| (c.slug, c)))
            .collect();

        // Build trip results
        let items: Vec<TripResult> = trips
            .iter()
            .filter_map(|t| {
                let sched = sched_map.get(&t.schedule_id.to_string())?;
                let route = route_map.get(&sched.route_id.to_string())?;
                let brand = route
                    .brand_id
                    .map(|id| id.to_string())
                    .as_deref()
                    .and_then(|bid| brand_map.get(bid));
                let layout = sched
                    .bus_layout_id
                    .and_then(|lid| layout_map.get(&lid.to_string()));

                // Vehicle type filter
                let vehicle_type = layout
                    .and_then(|l| l.vehicle_type.clone())
                    .unwrap_or_else(|| "standard".into());
                if !vehicle_types.is_empty() && !vehicle_types.contains(&vehicle_type) {
                    return None;
                }

                let from_place = place_map.get(route.start_location_id.as_str());
                let to_place = place_map.get(route.end_location_id.as_str());

                let amenities = parse_amenities(&sched.amenities);
                let (dep_iso, arr_iso) = compute_iso_timestamps(
                    &Some(t.departure_date.clone()),
                    &Some(sched.departure_time.clone()),
                );
                let vt_label = vehicle_type_label(&vehicle_type);

                Some(TripResult {
                    trip_id: t.id,
                    schedule_id: sched.id,
                    departure_date: t.departure_date.clone(),
                    status: t.status.clone(),
                    available_seats: t.available_seats,
                    total_seats: t.total_seats,
                    route_id: route.id,
                    route_name: route.name.clone(),
                    brand_id: route.brand_id,
                    brand_name: brand.map(|b| b.name.clone()).unwrap_or_default(),
                    brand_slug: brand.map(|b| b.slug.clone()).unwrap_or_default(),
                    brand_logo: brand.and_then(|b| b.logo_url.clone()),
                    brand_rating: brand.and_then(|b| b.rating).unwrap_or(0.0),
                    brand_accent: brand
                        .and_then(|b| b.accent_color.clone())
                        .unwrap_or_else(|| "#0d9488".into()),
                    from_name: from_place.map(|p| p.name.to_string()).unwrap_or_default(),
                    from_lat: from_place.map(|p| p.lat).unwrap_or(0.0),
                    from_lon: from_place.map(|p| p.lon).unwrap_or(0.0),
                    to_name: to_place.map(|p| p.name.to_string()).unwrap_or_default(),
                    to_lat: to_place.map(|p| p.lat).unwrap_or(0.0),
                    to_lon: to_place.map(|p| p.lon).unwrap_or(0.0),
                    departure_time: Some(sched.departure_time.clone()),
                    departure_at: dep_iso,
                    arrival_at: arr_iso,
                    bus_layout_id: sched.bus_layout_id.map(|u| u.to_string()),
                    min_price: sched.base_price_adult,
                    max_price: sched.base_price_adult,
                    price_adult: sched.base_price_adult,
                    price_child: sched.base_price_child.unwrap_or(0),
                    vehicle_type,
                    vehicle_type_label: vt_label.to_string(),
                    capacity: layout.and_then(|l| l.total_seats),
                    amenities,
                })
            })
            .collect();

        Ok(TripSearchResponse { items })
    }

    /// Geospatial trip search — find routes where pickup points are closest
    /// to the user's desired pickup location AND drop points are closest to
    /// the desired drop location.
    ///
    /// Uses a bounding-box SQL query to find candidate pickup_points,
    /// then computes haversine distances in Rust + sorts by combined
    /// distance. This avoids needing PostGIS or SQLite math functions.
    ///
    /// Parameters:
    /// - `from_lat, from_lon` — desired pickup coordinates
    /// - `to_lat, to_lon` — desired drop coordinates
    /// - `date` — departure date "YYYY-MM-DD"
    /// - `limit, offset` — pagination
    /// - `min_seats` — minimum available seats (default 1)
    /// - `vehicle_types` — filter by vehicle type (empty = all)
    /// - `max_distance_km` — max distance from desired pickup/drop to
    ///   nearest route stop (default 50 km). Routes with no stop within
    ///   this radius are excluded.
    pub async fn search_trips_geo(
        &self,
        from_lat: f64,
        from_lon: f64,
        to_lat: f64,
        to_lon: f64,
        date: &str,
        limit: u64,
        offset: u64,
        min_seats: i64,
        vehicle_types: Vec<String>,
        max_distance_km: f64,
    ) -> AppResult<TripSearchResponse> {
        let limit = limit.clamp(1, 100);
        let min_seats = min_seats.max(1);
        let max_dist = max_distance_km.max(1.0);

        // ── Bounding box ──────────────────────────────────────────
        //
        // Convert km to degrees: ~1° latitude ≈ 111 km.
        // For longitude, divide by cos(lat) to account for Earth's curvature.
        // We use a generous box (max_dist * 1.2) to catch edge cases.
        let lat_delta = (max_dist / 111.0) * 1.2;
        let lon_delta = (max_dist / (111.0 * from_lat.to_radians().cos().abs().max(0.01))) * 1.2;
        let to_lon_delta = (max_dist / (111.0 * to_lat.to_radians().cos().abs().max(0.01))) * 1.2;

        let candidates = self
            .store
            .route_store()
            .find_pickup_points_in_bbox(
                from_lat - lat_delta, from_lat + lat_delta,
                from_lon - lon_delta, from_lon + lon_delta,
                to_lat - lat_delta, to_lat + lat_delta,
                to_lon - to_lon_delta, to_lon + to_lon_delta,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if candidates.is_empty() {
            return Ok(TripSearchResponse { items: Vec::new() });
        }

        // ── Group by route_id + find closest pickup/drop per route ──────
        use std::collections::HashMap;
        let mut route_map: HashMap<Uuid, Vec<&PickupPointWithRoute>> = HashMap::new();
        for c in &candidates {
            route_map.entry(c.route_id).or_default().push(c);
        }

        // For each route, find:
        // - The pickup_point closest to (from_lat, from_lon)
        // - The pickup_point closest to (to_lat, to_lon)
        // - Check direction: pickup.stop_order < drop.stop_order
        // - Combined distance = pickup_dist + drop_dist
        #[derive(Clone)]
        struct RouteMatch {
            route_id: Uuid,
            route_name: String,
            brand_id: Option<Uuid>,
            pickup_point_id: Uuid,
            drop_point_id: Uuid,
            pickup_distance_km: f64,
            drop_distance_km: f64,
            combined_distance_km: f64,
        }

        let mut matches: Vec<RouteMatch> = Vec::new();
        for (route_id, points) in &route_map {
            // Find closest pickup (near `from`)
            let mut best_pickup: Option<(&PickupPointWithRoute, f64)> = None;
            for p in points {
                if let (Some(p_lat), Some(p_lon)) = (p.lat, p.lon) {
                    let dist = haversine_km(from_lat, from_lon, p_lat, p_lon);
                    if dist <= max_dist {
                        if best_pickup.is_none() || dist < best_pickup.unwrap().1 {
                            best_pickup = Some((p, dist));
                        }
                    }
                }
            }
            let pickup = match best_pickup {
                Some((p, d)) => (p, d),
                None => continue, // No pickup point within range
            };

            // Find closest drop (near `to`) with stop_order > pickup's stop_order
            let mut best_drop: Option<(&PickupPointWithRoute, f64)> = None;
            for p in points {
                if p.stop_order <= pickup.0.stop_order {
                    continue; // Must be AFTER the pickup in route order
                }
                if let (Some(p_lat), Some(p_lon)) = (p.lat, p.lon) {
                    let dist = haversine_km(to_lat, to_lon, p_lat, p_lon);
                    if dist <= max_dist {
                        if best_drop.is_none() || dist < best_drop.unwrap().1 {
                            best_drop = Some((p, dist));
                        }
                    }
                }
            }
            let drop = match best_drop {
                Some((p, d)) => (p, d),
                None => continue, // No drop point within range or in the right direction
            };

            matches.push(RouteMatch {
                route_id: *route_id,
                route_name: pickup.0.route_name.clone(),
                brand_id: pickup.0.brand_id,
                pickup_point_id: pickup.0.pickup_id,
                drop_point_id: drop.0.pickup_id,
                pickup_distance_km: pickup.1,
                drop_distance_km: drop.1,
                combined_distance_km: pickup.1 + drop.1,
            });
        }

        if matches.is_empty() {
            return Ok(TripSearchResponse { items: Vec::new() });
        }

        // Sort by combined distance (closest first)
        matches.sort_by(|a, b| a.combined_distance_km.partial_cmp(&b.combined_distance_km).unwrap_or(std::cmp::Ordering::Equal));

        // Paginate
        let total = matches.len();
        let paged: Vec<&RouteMatch> = matches.iter().skip(offset as usize).take(limit as usize).collect();
        if paged.is_empty() {
            return Ok(TripSearchResponse { items: Vec::new() });
        }

        // Load schedules + trips for the matched routes
        let route_uuids: Vec<Uuid> = paged.iter().map(|m| m.route_id).collect();
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(route_uuids.clone())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if schedules.is_empty() {
            return Ok(TripSearchResponse { items: Vec::new() });
        }

        let schedule_uuids: Vec<Uuid> = schedules.iter().map(|s| s.id).collect();
        let trips = self
            .store
            .trip_store()
            .list_trips_by_schedule_ids(schedule_uuids, date, min_seats, 1000)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if trips.is_empty() {
            return Ok(TripSearchResponse { items: Vec::new() });
        }

        // Build schedule lookup: schedule_id → schedule
        let schedule_map: HashMap<Uuid, &crate::entity::schedule::Model> = schedules.iter().map(|s| (s.id, s)).collect();

        // Build route match lookup: route_id → RouteMatch
        let match_map: HashMap<Uuid, &RouteMatch> = paged.iter().map(|m| (m.route_id, *m)).collect();
        let _ = total; // total count for potential future pagination metadata

        // Build route lookup — the PickupPointWithRoute already has route_name
        // + brand_id, so we don't need to re-fetch routes. Use the candidate data.
        use std::collections::HashSet;
        let route_info_map: HashMap<Uuid, &PickupPointWithRoute> =
            paged.iter().map(|m| (m.route_id, {
                // Find the first candidate that matches this route
                candidates.iter().find(|c| c.route_id == m.route_id).unwrap()
            })).collect();

        // Build brand lookup — fetch by IDs using raw SQL
        let brand_ids: Vec<Uuid> = paged.iter().filter_map(|m| m.brand_id).collect::<HashSet<_>>().into_iter().collect();
        let brands = if !brand_ids.is_empty() {
            use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
            brand::Entity::find()
                .filter(brand::Column::Id.is_in(brand_ids.clone()))
                .all(self.store.db())
                .await
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        let brand_map: HashMap<Uuid, &brand::Model> = brands.iter().map(|b| (b.id, b)).collect();

        // Build items — sorted by combined_distance_km (already sorted)
        let mut items: Vec<TripResult> = Vec::new();
        for trip in &trips {
            let schedule = match schedule_map.get(&trip.schedule_id) {
                Some(s) => *s,
                None => continue,
            };
            let m = match match_map.get(&schedule.route_id) {
                Some(m) => *m,
                None => continue,
            };
            let route_info = match route_info_map.get(&schedule.route_id) {
                Some(r) => *r,
                None => continue,
            };

            // Vehicle type filter
            let vehicle_type = schedule
                .bus_layout_id
                .map(|u| u.to_string())
                .unwrap_or_else(|| "standard".to_string());
            if !vehicle_types.is_empty()
                && !vehicle_types.iter().any(|vt| *vt == vehicle_type)
            {
                continue;
            }

            let brand = m.brand_id.and_then(|bid| brand_map.get(&bid)).cloned();

            let amenities: Vec<String> = schedule
                .amenities
                .as_ref()
                .map(|a| a.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default();

            items.push(TripResult {
                trip_id: trip.id,
                schedule_id: trip.schedule_id,
                route_id: schedule.route_id,
                departure_date: trip.departure_date.clone(),
                status: trip.status.clone(),
                available_seats: trip.available_seats,
                total_seats: trip.total_seats,
                route_name: route_info.route_name.clone(),
                brand_id: brand.map(|b| b.id),
                brand_name: brand.map(|b| b.name.clone()).unwrap_or_default(),
                brand_slug: brand.map(|b| b.slug.clone()).unwrap_or_default(),
                brand_logo: brand.and_then(|b| b.logo_url.clone()).unwrap_or_default().into(),
                brand_rating: brand.and_then(|b| b.rating).unwrap_or_default(),
                brand_accent: brand.and_then(|b| b.accent_color.clone()).unwrap_or_default(),
                from_name: format!("{:.4}, {:.4}", from_lat, from_lon),
                to_name: format!("{:.4}, {:.4}", to_lat, to_lon),
                from_lat,
                from_lon,
                to_lat,
                to_lon,
                departure_time: Some(schedule.departure_time.clone()),
                departure_at: trip.actual_departure_at.clone(),
                arrival_at: None,
                bus_layout_id: schedule.bus_layout_id.map(|u| u.to_string()),
                min_price: schedule.base_price_adult,
                max_price: schedule.base_price_adult,
                price_adult: schedule.base_price_adult,
                price_child: schedule.base_price_child.unwrap_or(0),
                vehicle_type: vehicle_type.to_string(),
                vehicle_type_label: vehicle_type.to_string(),
                capacity: None,
                amenities,
            });
        }

        Ok(TripSearchResponse { items })
    }

    /// Trip detail by id — full enriched TripDetail shape.
    pub async fn trip_detail(&self, id: Uuid) -> AppResult<TripDetail> {
        let trip = self
            .store
            .trip_store()
            .find_trip_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("trip not found".into()))?;

        let schedule = self
            .store
            .schedule_store()
            .find_schedule_by_id(trip.schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let route_id = schedule.route_id;
        let route = self
            .store
            .route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        // The lookups below depend only on `route` + `schedule`
        // (already loaded above) — they're independent of each other.
        // Running them concurrently with `tokio::try_join!` cuts 3
        // sequential DB round-trips down to 1 (the slowest one).
        //
        // Note: `route.start_location_id` / `route.end_location_id`
        // are now slug strings (NOT NULL), not UUID FKs to `place`.
        // The slug → city resolution is synchronous (no DB hit), so
        // we wrap it in an async block to keep the `tokio::try_join!`
        // shape uniform with the brand + bus_layout + pickup_points
        // futures.
        let brand_id_uid = route.brand_id;
        let start_location_slug = route.start_location_id.clone();
        let end_location_slug = route.end_location_id.clone();
        let bus_layout_uid = schedule.bus_layout_id;

        let brand_fut = async {
            if let Some(uid) = brand_id_uid {
                self.store.brand_store().get_by_id(uid).await
            } else {
                Ok(None)
            }
        };
        let start_place_fut = async {
            Ok::<_, crate::store::StoreError>(crate::cities::find_by_slug(&start_location_slug))
        };
        let end_place_fut = async {
            Ok::<_, crate::store::StoreError>(crate::cities::find_by_slug(&end_location_slug))
        };
        let bus_layout_fut = async {
            if let Some(uid) = bus_layout_uid {
                self.store.schedule_store().find_bus_layout_by_id(uid).await
            } else {
                Ok(None)
            }
        };
        // Need let bindings so the temporary String + the temporary
        // `&RouteStore` borrow live long enough for the future (which
        // borrows them) to be polled.
        let route_id_str = route.id.to_string();
        let route_store = self.store.route_store();
        let pickup_points_fut = route_store.list_pickup_points_by_route(&route_id_str);

        let (brand, start_place, end_place, bus_layout, pickup_points) = tokio::try_join!(
            brand_fut,
            start_place_fut,
            end_place_fut,
            bus_layout_fut,
            pickup_points_fut,
        )?;

        let pickup_items: Vec<TripPickupPoint> = pickup_points
            .iter()
            .map(|p| TripPickupPoint {
                id: p.id,
                name: p.name.clone(),
                stop_order: Some(p.stop_order),
                lat: p.lat,
                lon: p.lon,
                kind: p.kind.clone(),
                address: p.address.clone(),
            })
            .collect();

        // Seat map — fetch all seats for the bus layout + their inventory
        let seat_rows = if let Some(blid) = schedule.bus_layout_id {
            self.store
                .trip_store()
                .list_seats_by_bus_layout_id(&blid.to_string())
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        } else {
            Vec::new()
        };

        let seat_ids: Vec<String> = seat_rows.iter().map(|s| s.id.to_string()).collect();
        let seat_inv = if !seat_ids.is_empty() {
            self.store
                .trip_store()
                .list_seat_inventories(&trip.id.to_string(), seat_ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        } else {
            Vec::new()
        };

        let inv_map: std::collections::HashMap<String, &seat_inventory::Model> = seat_inv
            .iter()
            .map(|si| (si.seat_id.to_string(), si))
            .collect();

        // Group seats by deck → row
        let mut decks_map: BTreeMap<i16, BTreeMap<i16, Vec<TripSeat>>> = BTreeMap::new();
        for s in &seat_rows {
            let deck = s.floor;
            let row_num = s.row_num.unwrap_or(0);
            let inv = inv_map.get(&s.id.to_string());
            let seat = TripSeat {
                id: s.id,
                code: s.seat_label.clone(),
                seat_label: s.seat_label.clone(),
                row: row_num,
                col: s.col_num.unwrap_or(0),
                deck,
                seat_class: s.seat_class.clone(),
                status: inv
                    .map(|i| i.status.clone())
                    .unwrap_or_else(|| "available".into()),
                final_price: inv.map(|i| i.final_price).unwrap_or(0),
            };
            decks_map
                .entry(deck)
                .or_default()
                .entry(row_num)
                .or_default()
                .push(seat);
        }

        let decks: Vec<TripSeatDeck> = decks_map
            .into_iter()
            .map(|(deck, rows_map)| {
                let rows: Vec<TripSeatRow> = rows_map
                    .into_iter()
                    .map(|(row_num, seats)| TripSeatRow {
                        row: row_num,
                        seats,
                    })
                    .collect();
                TripSeatDeck { deck, rows }
            })
            .collect();

        // Active campaigns
        let campaigns = self
            .store
            .trip_store()
            .list_active_campaigns(10)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let campaigns_vec: Vec<TripCampaign> = campaigns
            .iter()
            .map(|c| TripCampaign {
                id: c.id,
                code: c.code.clone(),
                discount_type: c.discount_type.clone(),
                discount_value: c.discount_value,
                max_uses: c.max_uses,
                used_count: c.used_count,
                starts_at: c.starts_at.clone(),
                ends_at: c.ends_at.clone(),
                status: c.status.clone(),
            })
            .collect();

        // Assemble
        let amenities = parse_amenities(&schedule.amenities);
        let amenities_vec: Vec<TripAmenity> = amenities
            .iter()
            .map(|a| TripAmenity {
                key: a.clone(),
                label: amenity_label(a).to_string(),
            })
            .collect();

        let (dep_iso, arr_iso) = compute_iso_timestamps(
            &Some(trip.departure_date.clone()),
            &Some(schedule.departure_time.clone()),
        );
        let vehicle_type = bus_layout
            .as_ref()
            .and_then(|l| l.vehicle_type.clone())
            .unwrap_or_else(|| "standard".into());
        let vt_label = vehicle_type_label(&vehicle_type);

        Ok(TripDetail {
            trip: TripCore {
                id: trip.id,
                departure_date: trip.departure_date,
                departure_at: dep_iso,
                departure_time: Some(schedule.departure_time),
                arrival_at: arr_iso,
                status: trip.status,
                driver_name: trip.driver_name,
                total_seats: trip.total_seats,
                available_seats: trip.available_seats,
            },
            route: TripRouteDetail {
                id: route.id,
                name: route.name,
            },
            brand: TripBrandDetail {
                id: route.brand_id.map(|id| id.to_string()),
                name: brand.as_ref().map(|b| b.name.clone()),
                slug: brand.as_ref().map(|b| b.slug.clone()),
                logo_url: brand.as_ref().and_then(|b| b.logo_url.clone()),
                rating: brand.as_ref().and_then(|b| b.rating).unwrap_or(0.0),
                accent_color: brand.as_ref().and_then(|b| b.accent_color.clone()),
            },
            from: TripEndpoint {
                name: start_place.map(|c| c.name.to_string()),
                lat: start_place.map(|c| c.lat).unwrap_or(0.0),
                lon: start_place.map(|c| c.lon).unwrap_or(0.0),
            },
            to: TripEndpoint {
                name: end_place.map(|c| c.name.to_string()),
                lat: end_place.map(|c| c.lat).unwrap_or(0.0),
                lon: end_place.map(|c| c.lon).unwrap_or(0.0),
            },
            bus_layout: TripBusLayout {
                id: schedule.bus_layout_id.map(|u| u.to_string()),
                name: bus_layout.as_ref().and_then(|l| l.name.clone()),
                capacity: bus_layout.as_ref().and_then(|l| l.total_seats),
                vehicle_type,
                vehicle_type_label: vt_label.to_string(),
            },
            pricing: TripPricing {
                base_price_adult: schedule.base_price_adult,
                base_price_child: schedule.base_price_child.unwrap_or(0),
            },
            amenities: amenities_vec,
            pickup_points: pickup_items,
            seat_map: TripSeatMap { decks },
            campaigns: campaigns_vec,
        })
    }

    /// Recommended trips (up to 4) — upcoming trips with available seats.
    pub async fn recommendations(&self) -> AppResult<TripSearchResponse> {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let trips = self
            .store
            .trip_store()
            .list_upcoming_trips(&today, 4)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Reuse search_trips serialization logic
        let items: Vec<TripResult> = {
            let trip_sched_uuids: Vec<Uuid> = trips.iter().map(|t| t.schedule_id).collect();
            let sched_map: std::collections::HashMap<String, schedule::Model> = self
                .store
                .schedule_store()
                .list_schedules_by_ids(trip_sched_uuids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|s| (s.id.to_string(), s))
                .collect();

            let sched_route_uuids: Vec<Uuid> = sched_map.values().map(|s| s.route_id).collect();
            let route_map: std::collections::HashMap<String, route::Model> = self
                .store
                .route_store()
                .list_routes_by_ids(sched_route_uuids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|r| (r.id.to_string(), r))
                .collect();

            let route_brand_uuids: Vec<Uuid> =
                route_map.values().filter_map(|r| r.brand_id).collect();
            let brand_map: std::collections::HashMap<String, brand::Model> = self
                .store
                .brand_store()
                .list_brands_by_ids(route_brand_uuids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|b| (b.id.to_string(), b))
                .collect();

            trips
                .iter()
                .filter_map(|t| {
                    let sched = sched_map.get(&t.schedule_id.to_string())?;
                    let route = route_map.get(&sched.route_id.to_string())?;
                    let brand = route
                        .brand_id
                        .map(|id| id.to_string())
                        .as_deref()
                        .and_then(|bid| brand_map.get(bid));
                    let amenities = parse_amenities(&sched.amenities);
                    let (dep_iso, arr_iso) = compute_iso_timestamps(
                        &Some(t.departure_date.clone()),
                        &Some(sched.departure_time.clone()),
                    );
                    let vehicle_type = "standard".to_string();
                    let vt_label = vehicle_type_label(&vehicle_type);

                    Some(TripResult {
                        trip_id: t.id,
                        schedule_id: sched.id,
                        departure_date: t.departure_date.clone(),
                        status: t.status.clone(),
                        available_seats: t.available_seats,
                        total_seats: t.total_seats,
                        route_id: route.id,
                        route_name: route.name.clone(),
                        brand_id: route.brand_id,
                        brand_name: brand.map(|b| b.name.clone()).unwrap_or_default(),
                        brand_slug: brand.map(|b| b.slug.clone()).unwrap_or_default(),
                        brand_logo: brand.and_then(|b| b.logo_url.clone()),
                        brand_rating: brand.and_then(|b| b.rating).unwrap_or(0.0),
                        brand_accent: brand
                            .and_then(|b| b.accent_color.clone())
                            .unwrap_or_else(|| "#0d9488".into()),
                        from_name: String::new(),
                        from_lat: 0.0,
                        from_lon: 0.0,
                        to_name: String::new(),
                        to_lat: 0.0,
                        to_lon: 0.0,
                        departure_time: Some(sched.departure_time.clone()),
                        departure_at: dep_iso,
                        arrival_at: arr_iso,
                        bus_layout_id: sched.bus_layout_id.map(|u| u.to_string()),
                        min_price: sched.base_price_adult,
                        max_price: sched.base_price_adult,
                        price_adult: sched.base_price_adult,
                        price_child: sched.base_price_child.unwrap_or(0),
                        vehicle_type,
                        vehicle_type_label: vt_label.to_string(),
                        capacity: None,
                        amenities,
                    })
                })
                .collect()
        };

        Ok(TripSearchResponse { items })
    }

    // ── Campaigns ───────────────────────────────────────────────

    /// List active campaigns.
    pub async fn list_campaigns(&self) -> AppResult<CampaignListResponse> {
        let campaigns = self
            .store
            .trip_store()
            .list_active_campaigns(100)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<CampaignOut> = campaigns
            .iter()
            .map(|c| CampaignOut {
                id: c.id,
                code: c.code.clone(),
                discount_type: c.discount_type.clone(),
                discount_value: c.discount_value,
                ends_at: c.ends_at.clone(),
            })
            .collect();
        Ok(CampaignListResponse { items })
    }

    /// Validate a campaign code against a subtotal.
    pub async fn validate_campaign(
        &self,
        code: &str,
        subtotal: i64,
    ) -> AppResult<CampaignValidateResponse> {
        let code = code.trim();
        if code.is_empty() {
            return Err(AppError::BadRequest("missing campaign code".into()));
        }
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let c = self
            .store
            .trip_store()
            .find_active_campaign(&code.to_uppercase(), &now)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        match c {
            Some(c) => {
                let discount = match c.discount_type.as_str() {
                    "percent" => {
                        ((subtotal as f64) * c.discount_value as f64 / 100.0).round() as i64
                    }
                    "fixed_amount" => c.discount_value,
                    _ => 0,
                };
                Ok(CampaignValidateResponse {
                    valid: true,
                    discount,
                })
            }
            None => Ok(CampaignValidateResponse {
                valid: false,
                discount: 0,
            }),
        }
    }

    // ── Stats ───────────────────────────────────────────────────

    /// Public stats for the homepage.
    pub async fn stats(&self) -> AppResult<StatsResponse> {
        let brand_count = self
            .store
            .brand_store()
            .count_active_brands()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let route_count = self
            .store
            .route_store()
            .count_active_routes()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let trip_count = self
            .store
            .trip_store()
            .count_trips_by_status("scheduled")
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(StatsResponse {
            brands: brand_count,
            routes: route_count,
            trips: trip_count,
        })
    }
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_amenities_handles_json_array() {
        let r = parse_amenities(&Some(r#"["wifi","ac","charging"]"#.into()));
        assert_eq!(r, vec!["wifi", "ac", "charging"]);
    }

    #[test]
    fn parse_amenities_handles_comma_separated() {
        let r = parse_amenities(&Some("wifi,ac,charging".into()));
        assert_eq!(r, vec!["wifi", "ac", "charging"]);
    }

    #[test]
    fn parse_amenities_handles_empty_and_none() {
        assert!(parse_amenities(&None).is_empty());
        assert!(parse_amenities(&Some("".into())).is_empty());
        assert!(parse_amenities(&Some("   ".into())).is_empty());
    }

    #[test]
    fn vehicle_type_label_maps_known_types() {
        assert_eq!(vehicle_type_label("sleeper"), "Giường nằm");
        assert_eq!(vehicle_type_label("limousine"), "Limousine");
        assert_eq!(vehicle_type_label("standard"), "Ghế ngồi");
        assert_eq!(vehicle_type_label("unknown"), "Ghế ngồi");
    }

    #[test]
    fn compute_iso_timestamps_returns_departure_only() {
        // Arrival is no longer computed from a route-level duration —
        // callers that need an ETA must derive it from a Valhalla
        // directions request between the route's endpoints.
        let (dep, arr) = compute_iso_timestamps(
            &Some("2026-08-05".into()),
            &Some("08:30".into()),
        );
        assert_eq!(dep.as_deref(), Some("2026-08-05T08:30:00"));
        assert_eq!(arr, None);
    }

    #[test]
    fn compute_iso_timestamps_handles_missing_time() {
        let (dep, arr) = compute_iso_timestamps(
            &Some("2026-08-05".into()),
            &None,
        );
        // Falls back to the time part embedded in the date string.
        // Since "2026-08-05" has no time part, both are None.
        assert_eq!(dep, None);
        assert_eq!(arr, None);
    }
}
