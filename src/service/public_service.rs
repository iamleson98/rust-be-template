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
use crate::entity::{brand, bus_layout, place, route, schedule, seat_inventory};
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

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

/// Compute full ISO departure/arrival timestamps from date + time + duration.
fn compute_iso_timestamps(
    departure_date: &Option<String>,
    departure_time: &Option<String>,
    duration_min: &Option<i64>,
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
    let dep_min = match parse_hhmm_to_minutes(dep_time) {
        Some(m) => m,
        None => return (Some(dep_iso), None),
    };
    let dur = duration_min.unwrap_or(0).max(0);
    let mut total = dep_min + dur;
    let extra_days = total / (24 * 60);
    total %= 24 * 60;
    let hh = total / 60;
    let mm = total % 60;
    let arr_iso = if extra_days > 0 {
        match add_days_to_ymd(&date_only, extra_days) {
            Some(new_date) => format!("{}T{:02}:{:02}:00", new_date, hh, mm),
            None => dep_iso.clone(),
        }
    } else {
        format!("{}T{:02}:{:02}:00", date_only, hh, mm)
    };
    (Some(dep_iso), Some(arr_iso))
}

/// Parse "HH:MM" or "HH:MM:SS" into total minutes since midnight.
fn parse_hhmm_to_minutes(s: &str) -> Option<i64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 {
        return None;
    }
    let h: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    if !(0..24).contains(&h) || !(0..60).contains(&m) {
        return None;
    }
    Some(h * 60 + m)
}

/// Add `days` to a "YYYY-MM-DD" string.
fn add_days_to_ymd(ymd: &str, days: i64) -> Option<String> {
    let parts: Vec<&str> = ymd.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    let d: i64 = parts[2].parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let jd = ymd_to_julian(y, m, d)?;
    let new_jd = jd + days;
    let (ny, nm, nd) = julian_to_ymd(new_jd)?;
    Some(format!("{:04}-{:02}-{:02}", ny, nm, nd))
}

/// Convert a proleptic-Gregorian date to a Julian day number.
fn ymd_to_julian(y: i64, m: i64, d: i64) -> Option<i64> {
    let a = (14 - m) / 12;
    let y = y + 4800 - a;
    let m = m + 12 * a - 3;
    Some(d + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045)
}

/// Convert a Julian day number back to a proleptic-Gregorian date.
fn julian_to_ymd(jd: i64) -> Option<(i64, i64, i64)> {
    let jd = jd + 32044;
    let g = jd / 146097;
    let dg = jd % 146097;
    let c = (dg / 36524 + 1) * 3 / 4;
    let dc = dg - c * 36524;
    let b = dc / 1461;
    let db = dc % 1461;
    let a = (db / 365 + 1) * 3 / 4;
    let da = db - a * 365;
    let y = 400 * g + 100 * c + 4 * b + a;
    let m = (da * 5 + 308) / 153 - 2;
    let d = da - (153 * m + 2) / 5 + 1;
    let year = y - 4800 + (m + 2) / 12;
    let month = (m + 2) % 12 + 1;
    Some((year, month, d))
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
        let brand_ids: Vec<String> = routes.iter().filter_map(|r| r.brand_id.clone()).collect();
        let brand_uuids: Vec<Uuid> = brand_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let brands: std::collections::HashMap<String, brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id.to_string(), b))
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

        let mut schedule_count: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for s in &schedules {
            *schedule_count.entry(s.route_id.clone()).or_insert(0) += 1;
        }

        let items: Vec<RouteOut> = routes
            .iter()
            .map(|r| {
                let brand = r.brand_id.as_deref().and_then(|bid| brands.get(bid));
                let (from_name, to_name) = r
                    .name
                    .split_once(" → ")
                    .map(|(f, t)| (f.to_string(), t.to_string()))
                    .unwrap_or_else(|| (r.name.clone(), String::new()));

                RouteOut {
                    id: r.id,
                    brand_id: r.brand_id.clone(),
                    name: r.name.clone(),
                    distance_km: r.distance_km,
                    duration_min: r.duration_min,
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
                    schedule_count: schedule_count.get(&r.id.to_string()).copied().unwrap_or(0),
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

        // Find routes matching from/to names
        let all_routes = self
            .store
            .route_store()
            .list_routes_by_status("active", 1000)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Filter routes by name containing from → to
        let matching_routes: Vec<&route::Model> = all_routes
            .iter()
            .filter(|r| {
                let name_lower = r.name.to_lowercase();
                let from_lower = from.to_lowercase();
                let to_lower = to.to_lowercase();
                name_lower.contains(&from_lower) && name_lower.contains(&to_lower)
            })
            .collect();

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
        let trip_schedule_ids: Vec<String> = trips.iter().map(|t| t.schedule_id.clone()).collect();
        let trip_sched_uuids: Vec<Uuid> = trip_schedule_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let sched_map: std::collections::HashMap<String, schedule::Model> = self
            .store
            .schedule_store()
            .list_schedules_by_ids(trip_sched_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|s| (s.id.to_string(), s))
            .collect();

        let sched_route_ids: Vec<String> = sched_map.values().map(|s| s.route_id.clone()).collect();
        let sched_route_uuids: Vec<Uuid> = sched_route_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let route_map: std::collections::HashMap<String, route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(sched_route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|r| (r.id.to_string(), r))
            .collect();

        let route_brand_ids: Vec<String> = route_map
            .values()
            .filter_map(|r| r.brand_id.clone())
            .collect();
        let route_brand_uuids: Vec<Uuid> = route_brand_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let brand_map: std::collections::HashMap<String, brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(route_brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id.to_string(), b))
            .collect();

        // Fetch bus layouts for vehicle type filtering
        let bus_layout_ids: Vec<String> = sched_map
            .values()
            .filter_map(|s| s.bus_layout_id.clone())
            .collect();
        let bus_layout_uuids: Vec<Uuid> = bus_layout_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
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

        // Fetch start/end places for routes
        let place_ids: Vec<String> = route_map
            .values()
            .flat_map(|r| [r.start_location_id.clone(), r.end_location_id.clone()])
            .flatten()
            .collect();
        let place_uuids: Vec<Uuid> = place_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let place_map: std::collections::HashMap<String, place::Model> = self
            .store
            .place_store()
            .find_places_by_ids(place_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|p| (p.id.to_string(), p))
            .collect();

        // Build trip results
        let items: Vec<TripResult> = trips
            .iter()
            .filter_map(|t| {
                let sched = sched_map.get(&t.schedule_id)?;
                let route = route_map.get(&sched.route_id)?;
                let brand = route.brand_id.as_deref().and_then(|bid| brand_map.get(bid));
                let layout = sched
                    .bus_layout_id
                    .as_deref()
                    .and_then(|lid| layout_map.get(lid));

                // Vehicle type filter
                let vehicle_type = layout
                    .and_then(|l| l.vehicle_type.clone())
                    .unwrap_or_else(|| "standard".into());
                if !vehicle_types.is_empty() && !vehicle_types.contains(&vehicle_type) {
                    return None;
                }

                let from_place = route
                    .start_location_id
                    .as_deref()
                    .and_then(|pid| place_map.get(pid));
                let to_place = route
                    .end_location_id
                    .as_deref()
                    .and_then(|pid| place_map.get(pid));

                let amenities = parse_amenities(&sched.amenities);
                let (dep_iso, arr_iso) = compute_iso_timestamps(
                    &Some(t.departure_date.clone()),
                    &Some(sched.departure_time.clone()),
                    &route.duration_min.map(|d| d as i64),
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
                    distance_km: route.distance_km.unwrap_or(0.0),
                    duration_min: route.duration_min.unwrap_or(0),
                    brand_id: route.brand_id.clone(),
                    brand_name: brand.map(|b| b.name.clone()).unwrap_or_default(),
                    brand_slug: brand.map(|b| b.slug.clone()).unwrap_or_default(),
                    brand_logo: brand.and_then(|b| b.logo_url.clone()),
                    brand_rating: brand.and_then(|b| b.rating).unwrap_or(0.0),
                    brand_accent: brand
                        .and_then(|b| b.accent_color.clone())
                        .unwrap_or_else(|| "#0d9488".into()),
                    from_name: from_place.map(|p| p.name.clone()).unwrap_or_default(),
                    from_lat: from_place.map(|p| p.lat).unwrap_or(0.0),
                    from_lon: from_place.map(|p| p.lon).unwrap_or(0.0),
                    to_name: to_place.map(|p| p.name.clone()).unwrap_or_default(),
                    to_lat: to_place.map(|p| p.lat).unwrap_or(0.0),
                    to_lon: to_place.map(|p| p.lon).unwrap_or(0.0),
                    departure_time: Some(sched.departure_time.clone()),
                    departure_at: dep_iso,
                    arrival_at: arr_iso,
                    bus_layout_id: sched.bus_layout_id.clone(),
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

    /// Trip detail by id — full enriched TripDetail shape.
    pub async fn trip_detail(&self, id: Uuid) -> AppResult<TripDetail> {
        let trip = self
            .store
            .trip_store()
            .find_trip_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("trip not found".into()))?;

        let schedule_id =
            Uuid::parse_str(&trip.schedule_id).map_err(|e| AppError::Internal(e.to_string()))?;
        let schedule = self
            .store
            .schedule_store()
            .find_schedule_by_id(schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let route_id =
            Uuid::parse_str(&schedule.route_id).map_err(|e| AppError::Internal(e.to_string()))?;
        let route = self
            .store
            .route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        let brand = if let Some(ref bid) = route.brand_id {
            match Uuid::parse_str(bid) {
                Ok(uid) => self
                    .store
                    .brand_store()
                    .get_by_id(uid)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?,
                Err(_) => None,
            }
        } else {
            None
        };

        let start_place = if let Some(ref id) = route.start_location_id {
            match Uuid::parse_str(id) {
                Ok(uid) => self
                    .store
                    .place_store()
                    .find_place_by_id(uid)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?,
                Err(_) => None,
            }
        } else {
            None
        };

        let end_place = if let Some(ref id) = route.end_location_id {
            match Uuid::parse_str(id) {
                Ok(uid) => self
                    .store
                    .place_store()
                    .find_place_by_id(uid)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?,
                Err(_) => None,
            }
        } else {
            None
        };

        let bus_layout = if let Some(ref blid) = schedule.bus_layout_id {
            match Uuid::parse_str(blid) {
                Ok(uid) => self
                    .store
                    .schedule_store()
                    .find_bus_layout_by_id(uid)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?,
                Err(_) => None,
            }
        } else {
            None
        };

        // Pickup points
        let pickup_points = self
            .store
            .route_store()
            .list_pickup_points_by_route(&route.id.to_string())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

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
        let seat_rows = if let Some(ref blid) = schedule.bus_layout_id {
            self.store
                .trip_store()
                .list_seats_by_bus_layout_id(blid)
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

        let inv_map: std::collections::HashMap<String, &seat_inventory::Model> =
            seat_inv.iter().map(|si| (si.seat_id.clone(), si)).collect();

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
            &route.duration_min.map(|d| d as i64),
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
                distance_km: route.distance_km.unwrap_or(0.0),
                duration_min: route.duration_min,
            },
            brand: TripBrandDetail {
                id: route.brand_id,
                name: brand.as_ref().map(|b| b.name.clone()),
                slug: brand.as_ref().map(|b| b.slug.clone()),
                logo_url: brand.as_ref().and_then(|b| b.logo_url.clone()),
                rating: brand.as_ref().and_then(|b| b.rating).unwrap_or(0.0),
                accent_color: brand.as_ref().and_then(|b| b.accent_color.clone()),
            },
            from: TripEndpoint {
                name: start_place.as_ref().map(|p| p.name.clone()),
                lat: start_place.as_ref().map(|p| p.lat).unwrap_or(0.0),
                lon: start_place.as_ref().map(|p| p.lon).unwrap_or(0.0),
            },
            to: TripEndpoint {
                name: end_place.as_ref().map(|p| p.name.clone()),
                lat: end_place.as_ref().map(|p| p.lat).unwrap_or(0.0),
                lon: end_place.as_ref().map(|p| p.lon).unwrap_or(0.0),
            },
            bus_layout: TripBusLayout {
                id: schedule.bus_layout_id,
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
            let trip_schedule_ids: Vec<String> =
                trips.iter().map(|t| t.schedule_id.clone()).collect();
            let trip_sched_uuids: Vec<Uuid> = trip_schedule_ids
                .iter()
                .filter_map(|s| Uuid::parse_str(s).ok())
                .collect();
            let sched_map: std::collections::HashMap<String, schedule::Model> = self
                .store
                .schedule_store()
                .list_schedules_by_ids(trip_sched_uuids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|s| (s.id.to_string(), s))
                .collect();

            let sched_route_ids: Vec<String> =
                sched_map.values().map(|s| s.route_id.clone()).collect();
            let sched_route_uuids: Vec<Uuid> = sched_route_ids
                .iter()
                .filter_map(|s| Uuid::parse_str(s).ok())
                .collect();
            let route_map: std::collections::HashMap<String, route::Model> = self
                .store
                .route_store()
                .list_routes_by_ids(sched_route_uuids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|r| (r.id.to_string(), r))
                .collect();

            let route_brand_ids: Vec<String> = route_map
                .values()
                .filter_map(|r| r.brand_id.clone())
                .collect();
            let route_brand_uuids: Vec<Uuid> = route_brand_ids
                .iter()
                .filter_map(|s| Uuid::parse_str(s).ok())
                .collect();
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
                    let sched = sched_map.get(&t.schedule_id)?;
                    let route = route_map.get(&sched.route_id)?;
                    let brand = route.brand_id.as_deref().and_then(|bid| brand_map.get(bid));
                    let amenities = parse_amenities(&sched.amenities);
                    let (dep_iso, arr_iso) = compute_iso_timestamps(
                        &Some(t.departure_date.clone()),
                        &Some(sched.departure_time.clone()),
                        &route.duration_min.map(|d| d as i64),
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
                        distance_km: route.distance_km.unwrap_or(0.0),
                        duration_min: route.duration_min.unwrap_or(0),
                        brand_id: route.brand_id.clone(),
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
                        bus_layout_id: sched.bus_layout_id.clone(),
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
    fn parse_hhmm_to_minutes_works() {
        assert_eq!(parse_hhmm_to_minutes("00:00"), Some(0));
        assert_eq!(parse_hhmm_to_minutes("08:30"), Some(510));
        assert_eq!(parse_hhmm_to_minutes("23:59"), Some(1439));
        assert_eq!(parse_hhmm_to_minutes("24:00"), None);
        assert_eq!(parse_hhmm_to_minutes("abc"), None);
    }

    #[test]
    fn compute_iso_timestamps_same_day() {
        let (dep, arr) = compute_iso_timestamps(
            &Some("2026-08-05".into()),
            &Some("08:30".into()),
            &Some(180),
        );
        assert_eq!(dep.as_deref(), Some("2026-08-05T08:30:00"));
        assert_eq!(arr.as_deref(), Some("2026-08-05T11:30:00"));
    }

    #[test]
    fn compute_iso_timestamps_crosses_midnight() {
        let (dep, arr) = compute_iso_timestamps(
            &Some("2026-08-05".into()),
            &Some("23:00".into()),
            &Some(180),
        );
        assert_eq!(dep.as_deref(), Some("2026-08-05T23:00:00"));
        assert_eq!(arr.as_deref(), Some("2026-08-06T02:00:00"));
    }

    #[test]
    fn add_days_to_ymd_handles_month_boundary() {
        assert_eq!(add_days_to_ymd("2026-01-31", 1), Some("2026-02-01".into()));
        assert_eq!(add_days_to_ymd("2026-12-31", 1), Some("2027-01-01".into()));
        assert_eq!(add_days_to_ymd("2024-02-28", 1), Some("2024-02-29".into()));
        assert_eq!(add_days_to_ymd("2026-02-28", 1), Some("2026-03-01".into()));
    }

    #[test]
    fn add_days_to_ymd_rejects_malformed() {
        assert_eq!(add_days_to_ymd("not-a-date", 1), None);
        assert_eq!(add_days_to_ymd("2026-13-01", 1), None);
    }
}
