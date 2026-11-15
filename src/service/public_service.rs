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

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use uuid::Uuid;

use crate::dto::public::{
    BrandDetailOut, BrandListResponse, BrandOut, BrandProfile, RouteBrandPreview, RouteEndpoint,
    RouteListResponse, RouteOut, StatsResponse, TripAmenity, TripBrandDetail, TripBusLayout,
    TripCore, TripDeckPlan, TripDetail, TripEndpoint, TripFare, TripPickupPoint, TripPricing,
    TripRouteDetail, TripSchedulePoint, TripSearchResponse, TripSeat, TripSeatDeck, TripSeatMap,
    TripSeatRow, TripStopMatch,
};
use crate::entity::{
    brand, bus_layout, route, schedule, seat_inventory, trip_session, vehicle_type,
};
use crate::error::{AppError, AppResult};
use crate::service::fares::{self, ChildPolicy, Fare, FareTable};
use crate::service::place_service::haversine_km;
use crate::service::seat_plan;
use crate::service::trip_search;
use crate::service::trip_warmer;
use crate::service::{trip_stops, trip_time};
use crate::store::CompositeStore;
use crate::store::GeoBox;

// ────────────────────────────────────────────────────────────────
//  Pure helpers
// ────────────────────────────────────────────────────────────────

/// Most trips of one day a city search considers.
const CITY_TRIP_CAP: u64 = 500;
/// Most trips of one day a coordinate search considers.
const GEO_TRIP_CAP: u64 = 1000;
/// Most routes a city search considers.
const ROUTE_CAP: u64 = 1000;

/// Does `route` run from the searched origin to the searched destination?
///
/// By its endpoint cities whenever both it and the search name known
/// cities; by its name mentioning the origin before the destination only
/// otherwise. (The SQL name match is order-blind: "Hà Nội - Đà Nẵng"
/// also matched a search from Đà Nẵng to Hà Nội.)
fn runs_between(
    route: &route::Model,
    from_slugs: &[String],
    to_slugs: &[String],
    from_lower: &str,
    to_lower: &str,
) -> bool {
    let known = |slug: &str| crate::cities::find_by_slug(slug).is_some();
    if !from_slugs.is_empty()
        && !to_slugs.is_empty()
        && known(&route.start_location_id)
        && known(&route.end_location_id)
    {
        return from_slugs.contains(&route.start_location_id)
            && to_slugs.contains(&route.end_location_id);
    }
    let name = route.name.to_lowercase();
    matches!((name.find(from_lower), name.find(to_lower)), (Some(a), Some(b)) if a < b)
}

/// A stop of a trip near a searched place.
struct StopHit {
    order: i64,
    name: String,
    /// `HH:MM` the bus is there, when the timetable says.
    time: Option<String>,
    lat: f64,
    lon: f64,
}

/// The box around `center` that holds every point within `km` (degrees;
/// a little wider, the exact distance is measured afterwards).
fn geo_box((lat, lon): (f64, f64), km: f64) -> GeoBox {
    let lat_delta = km / 111.0 * 1.2;
    let lon_delta = km / (111.0 * lat.to_radians().cos().abs().max(0.01)) * 1.2;
    GeoBox {
        lat_min: lat - lat_delta,
        lat_max: lat + lat_delta,
        lon_min: lon - lon_delta,
        lon_max: lon + lon_delta,
    }
}

/// Where the customer boards and where they leave.
type StopPair = (TripStopMatch, TripStopMatch);

/// A stop of a route (its pickup point) with coordinates; none for one
/// without.
fn route_stop(
    order: i64,
    name: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Option<StopHit> {
    Some(StopHit {
        order,
        name: name.unwrap_or_default(),
        time: None,
        lat: lat?,
        lon: lon?,
    })
}

/// The stop pair of each group of stops that serves both places.
fn pairs_of(
    groups: &HashMap<Uuid, Vec<StopHit>>,
    from: (f64, f64),
    to: (f64, f64),
    max: f64,
) -> HashMap<Uuid, StopPair> {
    groups
        .iter()
        .filter_map(|(id, hits)| Some((*id, nearest_pair(hits, from, to, max)?)))
        .collect()
}

/// The pickup stop near `from` and a later drop-off stop near `to` (both
/// within `max` km) with the smallest total distance; none when the trip
/// does not serve both in that order.
fn nearest_pair(hits: &[StopHit], from: (f64, f64), to: (f64, f64), max: f64) -> Option<StopPair> {
    let near = |place: (f64, f64)| -> Vec<(&StopHit, f64)> {
        hits.iter()
            .map(|h| (h, haversine_km(place.0, place.1, h.lat, h.lon)))
            .filter(|(_, d)| *d <= max)
            .collect()
    };
    let (pickups, dropoffs) = (near(from), near(to));
    let (pickup, dropoff) = pickups
        .iter()
        .flat_map(|p| {
            dropoffs
                .iter()
                .filter(move |d| d.0.order > p.0.order)
                .map(move |d| (*p, *d))
        })
        .min_by(|a, b| (a.0 .1 + a.1 .1).total_cmp(&(b.0 .1 + b.1 .1)))?;
    let stop = |(hit, km): (&StopHit, f64)| TripStopMatch {
        name: hit.name.clone(),
        time: hit.time.clone(),
        distance_km: (km * 10.0).round() / 10.0,
    };
    Some((stop(pickup), stop(dropoff)))
}

/// A route's endpoint names: its cities' names — resolved from the
/// STRUCTURED city slugs (the admin form's canonical pick), not by
/// splitting the free-text route name — or, when neither city is known
/// (corrupt data), the legacy "A → B" name split so something always
/// renders.
pub(crate) fn endpoint_names(route: &route::Model) -> (String, String) {
    let (from, to) = (
        crate::cities::name_for_slug(&route.start_location_id),
        crate::cities::name_for_slug(&route.end_location_id),
    );
    if from != route.start_location_id || to != route.end_location_id {
        return (from, to);
    }
    route
        .name
        .split_once(" → ")
        .map(|(f, t)| (f.to_string(), t.to_string()))
        .unwrap_or_else(|| (route.name.clone(), String::new()))
}

/// The `(lat, lon)` of the city with this slug; `(0, 0)` for one the app
/// does not know.
pub(crate) fn city_point(slug: &str) -> (f64, f64) {
    crate::cities::find_by_slug(slug).map_or((0.0, 0.0), |c| (c.lat, c.lon))
}

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

/// Resolve a schedule's vehicle class into `(code, label)`:
/// 1. the schedule's explicit `vehicle_type_id` (admin-managed catalog),
/// 2. the bus layout's legacy `vehicle_type` string,
/// 3. `standard` as the default.
///
/// Legacy codes get their label from the catalog when one matches
/// (e.g. a bus layout still saying `limousine`), else the static map.
pub(crate) fn resolve_vehicle_type(
    sched: &schedule::Model,
    layout: Option<&bus_layout::Model>,
    vt_map: &HashMap<Uuid, vehicle_type::Model>,
) -> (String, String) {
    if let Some(vt) = sched.vehicle_type_id.and_then(|id| vt_map.get(&id)) {
        return (vt.code.clone(), vt.label.clone());
    }
    let code = layout
        .and_then(|l| l.vehicle_type.clone())
        .unwrap_or_else(|| "standard".into());
    let label = vt_map
        .values()
        .find(|v| v.code.eq_ignore_ascii_case(&code))
        .map(|v| v.label.clone())
        .unwrap_or_else(|| vehicle_type_label(&code).to_string());
    (code, label)
}

/// Parse a Schedule.amenities JSON string into a `Vec<String>`.
pub(crate) fn parse_amenities(raw: &Option<String>) -> Vec<String> {
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
pub(crate) fn compute_iso_timestamps(
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

/// Build the trip's arrival ISO timestamp from its departure date, the
/// schedule's departure time and the last stop's arrival time
/// (admin-configured `HH:MM`, validated on write). If the arrival
/// clock time is not after the departure clock time the trip crosses
/// midnight, so the calendar day rolls over +1 — this is what lets the
/// client flag "overnight" and show the correct arrival date. Returns
/// `None` when the schedule has no arrival times configured at all
/// (the frontend shows an honest "view detail" hint for that gap).
pub(crate) fn compute_arrival_iso(
    departure_date: &str,
    departure_hhmm: &str,
    arrival_hhmm: &str,
) -> Option<String> {
    let minutes_of = |t: &str| -> Option<i64> {
        let (h, m) = t.split_once(':')?;
        let h: i64 = h.parse().ok()?;
        let m: i64 = m.parse().ok()?;
        Some(h * 60 + m)
    };
    let arr = minutes_of(arrival_hhmm)?;
    let dep = minutes_of(departure_hhmm).unwrap_or(i64::MIN);
    let date_only = departure_date.split('T').next().unwrap_or(departure_date);
    let base = chrono::NaiveDate::parse_from_str(date_only, "%Y-%m-%d").ok()?;
    let day = if arr <= dep {
        base + chrono::Duration::days(1)
    } else {
        base
    };
    Some(format!("{}T{}:00", day.format("%Y-%m-%d"), arrival_hhmm))
}

/// Amenity key → Vietnamese label; the key itself for an amenity without
/// one.
pub(crate) fn amenity_label(key: &str) -> &str {
    match key {
        "wifi" => "WiFi",
        "ac" => "Điều hòa",
        "water" => "Nước uống",
        "charging" => "Cắm sạc",
        "blanket" => "Chăn mền",
        _ => key,
    }
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct PublicService {
    store: Arc<CompositeStore>,
    /// The trip-materialization subsystem handle (see
    /// `service::trip_warmer`): gap notifications go to the background
    /// warmer, and the shared fill lock keeps the inline fill idempotent.
    /// `Warmer::detached()` (tests, embedded harnesses) fills inline
    /// without a background task.
    warmer: trip_warmer::Warmer,
}

impl PublicService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self {
            store,
            warmer: trip_warmer::Warmer::detached(),
        }
    }

    /// `new` + a live warmer (see [`trip_warmer::spawn`]).
    pub fn with_warmer(store: Arc<CompositeStore>, warmer: trip_warmer::Warmer) -> Self {
        Self { store, warmer }
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

        let route_counts = self
            .store
            .route_store()
            .count_routes_by_brand_map(
                brands.iter().map(|b| b.id.to_string()).collect(),
                Some("active"),
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items: Vec<BrandOut> = brands
            .iter()
            .map(|b| BrandOut {
                id: b.id,
                slug: b.slug.clone(),
                name: b.name.clone(),
                logo_url: b.logo_url.clone(),
                rating: b.rating,
                route_count: route_counts.get(&b.id.to_string()).copied().unwrap_or(0),
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
            rating: b.rating,
        })
    }

    /// A brand's public page in one read; not found for an unknown or
    /// inactive brand.
    pub async fn brand_profile(&self, slug: &str) -> AppResult<BrandProfile> {
        crate::service::brand_profile::get(&self.store, slug).await
    }

    // ── Routes ──────────────────────────────────────────────────

    /// Active routes by name, optionally of one brand.
    pub async fn list_routes(
        &self,
        brand_id: Option<Uuid>,
        limit: u64,
    ) -> AppResult<RouteListResponse> {
        let limit = limit.clamp(1, 500);
        let route_store = self.store.route_store();
        let mut routes = match brand_id {
            Some(brand) => {
                let mut of_brand = route_store
                    .list_routes_by_brand(&brand.to_string())
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                of_brand.retain(|r| r.status == "active");
                of_brand.sort_by(|a, b| a.name.cmp(&b.name));
                of_brand
            }
            None => route_store
                .list_routes_by_status("active", limit)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?,
        };
        routes.truncate(limit as usize);

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
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(routes.iter().map(|r| r.id).collect())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut schedule_count: std::collections::HashMap<Uuid, usize> =
            std::collections::HashMap::new();
        for s in &schedules {
            *schedule_count.entry(s.route_id).or_insert(0) += 1;
        }
        // Lowest adult base price per route — the REAL "from" price for
        // route cards (never fabricated client-side).
        let mut price_from: std::collections::HashMap<Uuid, i64> = std::collections::HashMap::new();
        for s in &schedules {
            let entry = price_from.entry(s.route_id).or_insert(i64::MAX);
            if s.base_price_adult < *entry {
                *entry = s.base_price_adult;
            }
        }

        let items: Vec<RouteOut> = routes
            .iter()
            .map(|r| {
                let brand = r.brand_id.and_then(|bid| brands.get(&bid));
                let (from_name, to_name) = endpoint_names(r);
                let (from, to) = (
                    city_point(&r.start_location_id),
                    city_point(&r.end_location_id),
                );

                RouteOut {
                    id: r.id,
                    brand_id: r.brand_id,
                    name: r.name.clone(),
                    brand: RouteBrandPreview {
                        name: brand.map(|b| b.name.clone()),
                        slug: brand.map(|b| b.slug.clone()),
                        logo_url: brand.and_then(|b| b.logo_url.clone()),
                        rating: brand.and_then(|b| b.rating),
                    },
                    from: RouteEndpoint {
                        name: from_name,
                        lat: from.0,
                        lon: from.1,
                    },
                    to: RouteEndpoint {
                        name: to_name,
                        lat: to.0,
                        lon: to.1,
                    },
                    schedule_count: schedule_count.get(&r.id).copied().unwrap_or(0),
                    // `filter` guards the i64::MAX sentinel (a route whose
                    // every schedule costs i64::MAX is not a real route).
                    price_from: price_from.get(&r.id).copied().filter(|p| *p != i64::MAX),
                }
            })
            .collect();
        Ok(RouteListResponse { items })
    }

    // ── Trips ───────────────────────────────────────────────────

    /// Fill missing trips for a search — bounded and non-blocking.
    ///
    /// * notifies the background warmer (full repair + fill for the
    ///   date), then
    /// * fills the schedules this search found missing inline under a
    ///   strict [`trip_warmer::INLINE_FILL_BUDGET`] wall-clock budget,
    ///   skipping entirely when the warmer already holds the fill lock
    ///   (the 2026-10-11 outage pattern was searches queueing behind a
    ///   long fill).
    ///
    /// `schedules` should be the schedules the search found missing —
    /// passing just the subset avoids a redundant existence query inside
    /// the materializer. Failures degrade to serving whatever rows
    /// already exist; nothing here ever fails the search itself.
    async fn fill_trips_inline(&self, schedules: &[schedule::Model], date: &str) {
        self.warmer.notify(date);
        if schedules.is_empty() {
            return;
        }
        let deadline = Some(std::time::Instant::now() + trip_warmer::INLINE_FILL_BUDGET);
        match self
            .warmer
            .try_fill(self.store.as_ref(), schedules, date, deadline)
            .await
        {
            Ok(n) if n > 0 => {
                tracing::info!(n, %date, "search: inline trip fill");
            }
            Ok(_) => {}
            Err(e) => {
                tracing::warn!(%e, %date, "search: inline fill failed — serving existing rows");
            }
        }
    }

    /// Trips on `date` for `schedules` with at least `min_seats` left:
    /// the rows the warmer created, after filling any gap inline under
    /// a strict budget (see `fill_trips_inline`). Read-first: trips load
    /// BEFORE any fill and only schedules that are actually missing get
    /// materialized — in the steady state (the warmer has the sell window
    /// covered) zero writes. Gaps are judged on ALL scheduled trips — a
    /// sold-out trip exists and is not a gap to fill.
    async fn trips_on(
        &self,
        schedules: &[schedule::Model],
        date: &str,
        min_seats: i64,
        cap: u64,
    ) -> AppResult<Vec<trip_session::Model>> {
        let ids: Vec<Uuid> = schedules.iter().map(|s| s.id).collect();
        let trip_store = self.store.trip_store();
        let mut trips = trip_store
            .list_trips_by_schedule_ids(ids.clone(), date, 0, cap)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let today = trip_warmer::vn_today(chrono::Utc::now());
        if let (Ok(day), true) = (
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d"),
            date >= today.as_str(),
        ) {
            let have: HashSet<Uuid> = trips.iter().map(|t| t.schedule_id).collect();
            let missing: Vec<schedule::Model> = schedules
                .iter()
                .filter(|s| trip_warmer::schedule_runs_on(s, day) && !have.contains(&s.id))
                .cloned()
                .collect();
            if !missing.is_empty() {
                self.fill_trips_inline(&missing, date).await;
                trips = trip_store
                    .list_trips_by_schedule_ids(ids, date, 0, cap)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
            }
        }
        trips.retain(|t| t.available_seats >= min_seats);
        Ok(trips)
    }

    /// City search: trips on `opts.date` of the active routes from `from`
    /// to `to` (city names, accents and aliases like "Sài Gòn" resolved),
    /// in that direction, still to leave — filtered, sorted and paged by
    /// `trip_search::results`.
    pub async fn search_trips(
        &self,
        from: &str,
        to: &str,
        opts: &trip_search::Options,
    ) -> AppResult<TripSearchResponse> {
        let (from, to) = (from.trim(), to.trim());
        if from.is_empty() {
            return Err(AppError::BadRequest(
                "missing departure location (from)".into(),
            ));
        }
        if to.is_empty() {
            return Err(AppError::BadRequest("missing arrival location (to)".into()));
        }
        let routes = self.routes_between(from, to).await?;
        if routes.is_empty() {
            return trip_search::results(&self.store, Vec::new(), opts).await;
        }

        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(routes.iter().map(|r| r.id).collect())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let trips = self
            .trips_on(&schedules, &opts.date, opts.min_seats, CITY_TRIP_CAP)
            .await?;

        let schedule_map: HashMap<Uuid, &schedule::Model> =
            schedules.iter().map(|s| (s.id, s)).collect();
        let route_map: HashMap<Uuid, &route::Model> = routes.iter().map(|r| (r.id, r)).collect();
        let candidates = trips
            .into_iter()
            .filter_map(|trip| {
                let schedule = *schedule_map.get(&trip.schedule_id)?;
                let route = *route_map.get(&schedule.route_id)?;
                Some(trip_search::Candidate {
                    trip,
                    schedule: schedule.clone(),
                    route: route.clone(),
                    pickup: None,
                    dropoff: None,
                })
            })
            .collect();
        trip_search::results(&self.store, candidates, opts).await
    }

    /// Active routes from the city `from` to the city `to` (trimmed,
    /// non-empty names; accents and aliases like "Sài Gòn" resolved), in
    /// that direction.
    async fn routes_between(&self, from: &str, to: &str) -> AppResult<Vec<route::Model>> {
        let (from_lower, to_lower) = (from.to_lowercase(), to.to_lowercase());
        let slugs = |q: &str| -> Vec<String> {
            crate::cities::match_city_slugs(q)
                .into_iter()
                .map(str::to_string)
                .collect()
        };
        let (from_slugs, to_slugs) = (slugs(from), slugs(to));
        let mut routes = self
            .store
            .route_store()
            .search_active_routes(&from_lower, &to_lower, &from_slugs, &to_slugs, ROUTE_CAP)
            .await?;
        routes.retain(|r| runs_between(r, &from_slugs, &to_slugs, &from_lower, &to_lower));
        Ok(routes)
    }

    /// Coordinate search: trips on `opts.date` that
    /// - stop within `max_distance_km` of both the customer's pickup and
    ///   drop-off (in that order), or
    /// - with `cities` (the cities the two places are in), run between
    ///   those cities, however far their stops are,
    ///
    /// each with the stop pair nearest the places. A trip between the
    /// cities none of whose stops has coordinates is found too, with no
    /// pickup or drop-off, after the measured ones.
    ///
    /// A schedule with a timetable of its own is matched on ITS stops
    /// (with the time the bus is there); one without on its route's
    /// pickup points. Stops are found through the `(lat, lon)` indexes
    /// inside a box around each place, then measured exactly.
    pub async fn search_trips_geo(
        &self,
        from: (f64, f64),
        to: (f64, f64),
        max_distance_km: f64,
        opts: &trip_search::Options,
        cities: Option<(&str, &str)>,
    ) -> AppResult<TripSearchResponse> {
        let max = max_distance_km.clamp(1.0, 200.0);
        let (schedules, boarding) = self.boarding_schedules(from, to, max, cities).await?;
        if schedules.is_empty() {
            return trip_search::results(&self.store, Vec::new(), opts).await;
        }

        // Active routes only.
        let routes: HashMap<Uuid, route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(trip_search::unique(schedules.iter().map(|s| s.route_id)))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .filter(|r| r.status == "active")
            .map(|r| (r.id, r))
            .collect();
        let schedules: Vec<schedule::Model> = schedules
            .into_iter()
            .filter(|s| routes.contains_key(&s.route_id))
            .collect();

        let trips = self
            .trips_on(&schedules, &opts.date, opts.min_seats, GEO_TRIP_CAP)
            .await?;
        let schedule_map: HashMap<Uuid, &schedule::Model> =
            schedules.iter().map(|s| (s.id, s)).collect();
        let candidates = trips
            .into_iter()
            .filter_map(|trip| {
                let schedule = *schedule_map.get(&trip.schedule_id)?;
                let route = routes.get(&schedule.route_id)?;
                let (pickup, dropoff) = boarding.get(&schedule.id)?.clone().unzip();
                Some(trip_search::Candidate {
                    trip,
                    schedule: schedule.clone(),
                    route: route.clone(),
                    pickup,
                    dropoff,
                })
            })
            .collect();
        trip_search::results(&self.store, candidates, opts).await
    }

    /// The schedules a coordinate search looks at and where the customer
    /// boards each; `None` when the schedule runs between the searched
    /// cities but no stop of it has coordinates to measure.
    async fn boarding_schedules(
        &self,
        from: (f64, f64),
        to: (f64, f64),
        max: f64,
        cities: Option<(&str, &str)>,
    ) -> AppResult<(Vec<schedule::Model>, HashMap<Uuid, Option<StopPair>>)> {
        let internal = |e: crate::store::StoreError| AppError::Internal(e.to_string());
        let boxes = [geo_box(from, max), geo_box(to, max)];

        // Stops near both places: a schedule's own, and its route's for
        // a schedule without a timetable.
        let mut stops_by_schedule: HashMap<Uuid, Vec<StopHit>> = HashMap::new();
        for (point, address) in self
            .store
            .address_store()
            .find_schedule_stops_in_boxes(&boxes)
            .await
            .map_err(internal)?
        {
            stops_by_schedule
                .entry(point.schedule_id)
                .or_default()
                .push(StopHit {
                    order: point.stop_order,
                    name: address.name,
                    time: point.arrival_time.filter(|t| !t.is_empty()),
                    lat: address.lat,
                    lon: address.lon,
                });
        }
        let near = pairs_of(&stops_by_schedule, from, to, max);

        let [a, b] = boxes;
        let mut stops_by_route: HashMap<Uuid, Vec<StopHit>> = HashMap::new();
        for p in self
            .store
            .route_store()
            .find_pickup_points_in_bbox(
                a.lat_min, a.lat_max, a.lon_min, a.lon_max, b.lat_min, b.lat_max, b.lon_min,
                b.lon_max,
            )
            .await
            .map_err(internal)?
        {
            if let Some(hit) = route_stop(p.stop_order, p.name, p.lat, p.lon) {
                stops_by_route.entry(p.route_id).or_default().push(hit);
            }
        }
        let near_route = pairs_of(&stops_by_route, from, to, max);

        // Every route between the two cities.
        let city_route_ids: HashSet<Uuid> = match cities {
            Some((from_city, to_city)) => self
                .routes_between(from_city, to_city)
                .await?
                .into_iter()
                .map(|r| r.id)
                .collect(),
            None => HashSet::new(),
        };
        let route_ids: Vec<Uuid> = near_route
            .keys()
            .chain(&city_route_ids)
            .copied()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        if near.is_empty() && route_ids.is_empty() {
            return Ok((Vec::new(), HashMap::new()));
        }

        let schedule_store = self.store.schedule_store();
        let mut found = schedule_store
            .list_schedules_by_ids(near.keys().copied().collect())
            .await
            .map_err(internal)?;
        let others: Vec<schedule::Model> = schedule_store
            .list_schedules_by_routes(route_ids)
            .await
            .map_err(internal)?
            .into_iter()
            .filter(|s| !near.contains_key(&s.id))
            .collect();

        // Which of the others have a timetable (they board only at its
        // stops), and the stops of the city routes they would otherwise
        // board at, however far.
        let timetables = self
            .timetable_stops(others.iter().map(|s| s.id).collect())
            .await?;
        let mut city_stops: HashMap<Uuid, Vec<StopHit>> = HashMap::new();
        for route_id in others
            .iter()
            .filter(|s| {
                city_route_ids.contains(&s.route_id)
                    && !timetables.contains_key(&s.id)
                    && !near_route.contains_key(&s.route_id)
            })
            .map(|s| s.route_id)
            .collect::<HashSet<_>>()
        {
            let points = self
                .store
                .route_store()
                .list_pickup_points_by_route(&route_id.to_string())
                .await
                .map_err(internal)?;
            city_stops.insert(
                route_id,
                points
                    .into_iter()
                    .filter_map(|p| route_stop(p.stop_order, p.name, p.lat, p.lon))
                    .collect(),
            );
        }

        let mut boarding: HashMap<Uuid, Option<StopPair>> = near
            .into_iter()
            .map(|(id, pair)| (id, Some(pair)))
            .collect();
        for s in others {
            let on_city_route = city_route_ids.contains(&s.route_id);
            let pair = if let Some(own) = timetables.get(&s.id) {
                // Its own stops were already measured against the
                // distance; a schedule between the cities is kept with
                // its nearest stops, however far.
                if !on_city_route {
                    continue;
                }
                nearest_pair(own, from, to, f64::INFINITY)
            } else if let Some(pair) = near_route.get(&s.route_id) {
                Some(pair.clone())
            } else if on_city_route {
                nearest_pair(
                    city_stops.get(&s.route_id).map_or(&[][..], Vec::as_slice),
                    from,
                    to,
                    f64::INFINITY,
                )
            } else {
                continue;
            };
            boarding.insert(s.id, pair);
            found.push(s);
        }
        Ok((found, boarding))
    }

    /// The timetable stops (with the time the bus is there) of each of
    /// these schedules. Every schedule with a timetable has an entry.
    async fn timetable_stops(
        &self,
        schedule_ids: Vec<Uuid>,
    ) -> AppResult<HashMap<Uuid, Vec<StopHit>>> {
        let internal = |e: crate::store::StoreError| AppError::Internal(e.to_string());
        let address_store = self.store.address_store();
        let points = address_store
            .list_points_by_schedules(schedule_ids)
            .await
            .map_err(internal)?;
        let addresses: HashMap<Uuid, crate::entity::address::Model> = address_store
            .list_addresses_by_ids(points.iter().map(|p| p.address_id).collect())
            .await
            .map_err(internal)?
            .into_iter()
            .map(|a| (a.id, a))
            .collect();
        let mut out: HashMap<Uuid, Vec<StopHit>> = HashMap::new();
        for p in points {
            let hits = out.entry(p.schedule_id).or_default();
            if let Some(a) = addresses.get(&p.address_id) {
                hits.push(StopHit {
                    order: p.stop_order,
                    name: a.name.clone(),
                    time: p.arrival_time.filter(|t| !t.is_empty()),
                    lat: a.lat,
                    lon: a.lon,
                });
            }
        }
        Ok(out)
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
        let (brand, start_place, end_place, bus_layout) =
            tokio::try_join!(brand_fut, start_place_fut, end_place_fut, bus_layout_fut)?;

        // Where passengers can board and alight: the route's pickup points,
        // else the stops of the schedule's timetable.
        let pickup_items: Vec<TripPickupPoint> =
            trip_stops::trip_stops(&self.store, route.id, schedule.id)
                .await?
                .into_iter()
                .map(|s| TripPickupPoint {
                    id: s.id,
                    name: Some(s.name),
                    stop_order: Some(s.order),
                    lat: s.lat,
                    lon: s.lon,
                    kind: s.kind,
                    address: s.address,
                })
                .collect();

        // Schedule points — the real per-stop timetable (with arrival
        // times) the admin configured for this trip's schedule. Joined
        // with their addresses for display names + coordinates.
        let schedule_point_rows = self
            .store
            .address_store()
            .list_points_by_schedule(trip.schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let address_ids: Vec<Uuid> = schedule_point_rows.iter().map(|p| p.address_id).collect();
        let address_rows = self
            .store
            .address_store()
            .list_addresses_by_ids(address_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let address_map: std::collections::HashMap<Uuid, crate::entity::address::Model> =
            address_rows.into_iter().map(|a| (a.id, a)).collect();
        let schedule_items: Vec<TripSchedulePoint> = schedule_point_rows
            .iter()
            .filter_map(|p| {
                let a = address_map.get(&p.address_id)?;
                Some(TripSchedulePoint {
                    id: p.id,
                    stop_order: p.stop_order,
                    kind: p.kind.clone(),
                    arrival_time: p.arrival_time.clone(),
                    name: a.name.clone(),
                    address: a.address.clone(),
                    city_id: a.city_id.clone(),
                    lat: a.lat,
                    lon: a.lon,
                })
            })
            .collect();

        // Seats are created when a trip is first opened (see
        // `trip_warmer::ensure_seats`).
        trip_warmer::ensure_seats(&self.store, &trip, &schedule).await?;

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

        // The saved floor plan (fixtures + what each seat physically is),
        // trusted only while it still matches the seat rows.
        let plan = bus_layout
            .as_ref()
            .and_then(|l| seat_plan::trusted_plan(l.layout_data.as_deref(), &seat_rows));
        let kinds = plan
            .as_ref()
            .map(seat_plan::kinds_by_label)
            .unwrap_or_default();

        let fare_table = FareTable::load(&self.store, &schedule).await?;
        let policy = brand.as_ref().and_then(ChildPolicy::of);
        let child_price = standard_child_price(&schedule, policy);
        let mut class_fares: BTreeMap<String, FareSummary> = BTreeMap::new();

        // Group seats by deck → row
        let mut decks_map: BTreeMap<i16, BTreeMap<i16, Vec<TripSeat>>> = BTreeMap::new();
        for s in &seat_rows {
            let deck = s.floor;
            let row_num = s.row_num.unwrap_or(0);
            let inv = inv_map.get(&s.id.to_string());
            let class = fares::class_of(s);
            let fare = fare_table.fare(Some(&class));
            let status = inv
                .map(|i| i.status.clone())
                .unwrap_or_else(|| "available".into());
            let price = inv.map_or(fare.adult, |i| i.final_price);
            class_fares
                .entry(class)
                .or_insert_with(|| FareSummary::new(fare))
                .add(price, status == "available");
            let seat = TripSeat {
                id: s.id,
                code: s.seat_label.clone(),
                seat_label: s.seat_label.clone(),
                row: row_num,
                col: s.col_num.unwrap_or(0),
                deck,
                seat_class: s.seat_class.clone(),
                kind: kinds
                    .get(&(deck, s.seat_label.trim().to_lowercase()))
                    .copied(),
                status,
                final_price: price,
                child_price: fares::child_price(price, fare, policy),
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
                let frame = plan
                    .as_ref()
                    .and_then(|p| p.decks.get(usize::try_from(deck - 1).ok()?))
                    .map(|d| TripDeckPlan {
                        name: d.name.clone(),
                        rows: d.rows,
                        cols: d.cols,
                        fixtures: d
                            .cells
                            .iter()
                            .filter(|c| !c.kind.is_sellable())
                            .cloned()
                            .collect(),
                    });
                TripSeatDeck {
                    deck,
                    plan: frame,
                    rows,
                }
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

        let (dep_iso, _) = compute_iso_timestamps(
            &Some(trip.departure_date.clone()),
            &Some(schedule.departure_time.clone()),
        );
        // Real arrival from the last configured schedule stop (same
        // rule as the search endpoints) — the detail header + booking
        // flow can then show "start time → end time" honestly.
        let arr_iso = schedule_point_rows
            .iter()
            .rev()
            .filter_map(|p| p.arrival_time.as_deref())
            .find(|t| !t.is_empty())
            .and_then(|hhmm| {
                compute_arrival_iso(&trip.departure_date, &schedule.departure_time, hhmm)
            });
        let vt_map: HashMap<Uuid, vehicle_type::Model> = {
            let ids: Vec<Uuid> = schedule.vehicle_type_id.into_iter().collect();
            if ids.is_empty() {
                HashMap::new()
            } else {
                self.store
                    .vehicle_type_store()
                    .find_vehicle_types_by_ids(ids)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .map(|v| (v.id, v))
                    .collect()
            }
        };
        let (vehicle_type, vt_label) =
            resolve_vehicle_type(&schedule, bus_layout.as_ref(), &vt_map);

        let bookable = on_sale(&trip, &schedule);
        Ok(TripDetail {
            trip: TripCore {
                id: trip.id,
                bookable,
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
                rating: brand.as_ref().and_then(|b| b.rating),
            },
            from: TripEndpoint {
                city_id: start_place.map(|c| c.slug.to_string()),
                name: start_place.map(|c| c.name.to_string()),
                lat: start_place.map(|c| c.lat).unwrap_or(0.0),
                lon: start_place.map(|c| c.lon).unwrap_or(0.0),
            },
            to: TripEndpoint {
                city_id: end_place.map(|c| c.slug.to_string()),
                name: end_place.map(|c| c.name.to_string()),
                lat: end_place.map(|c| c.lat).unwrap_or(0.0),
                lon: end_place.map(|c| c.lon).unwrap_or(0.0),
            },
            bus_layout: TripBusLayout {
                id: schedule.bus_layout_id.map(|u| u.to_string()),
                name: bus_layout.as_ref().and_then(|l| l.name.clone()),
                capacity: bus_layout.as_ref().and_then(|l| l.total_seats),
                vehicle_type,
                vehicle_type_label: vt_label,
            },
            pricing: TripPricing {
                base_price_adult: schedule.base_price_adult,
                base_price_child: child_price,
                fares: trip_fares(class_fares, policy),
                child_fare: policy.map(Into::into),
            },
            amenities: amenities_vec,
            pickup_points: pickup_items,
            schedule_points: schedule_items,
            seat_map: TripSeatMap { decks },
        })
    }

    /// Recommended trips (up to 4) — the soonest upcoming trips with seats
    /// left, as result cards (the same card the search builds).
    pub async fn recommendations(&self) -> AppResult<TripSearchResponse> {
        let today = trip_time::local_today();
        let mut upcoming = self.upcoming_trips(&today).await?;
        if upcoming.is_empty() {
            self.fill_cold_database().await;
            upcoming = self.upcoming_trips(&today).await?;
        }

        let routes: HashMap<Uuid, route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(trip_search::unique(
                upcoming.iter().map(|(_, s)| s.route_id),
            ))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .filter(|r| r.status == "active")
            .map(|r| (r.id, r))
            .collect();
        let candidates = upcoming
            .into_iter()
            .filter(|(trip, schedule)| on_sale(trip, schedule))
            .filter_map(|(trip, schedule)| {
                let route = routes.get(&schedule.route_id)?.clone();
                Some(trip_search::Candidate {
                    trip,
                    schedule,
                    route,
                    pickup: None,
                    dropoff: None,
                })
            })
            .collect();
        let items = trip_search::cards(&self.store, candidates)
            .await?
            .into_iter()
            .take(RECOMMENDATIONS)
            .collect();
        Ok(TripSearchResponse::unpaginated(items))
    }

    /// The scheduled trips from `today` with seats left to consider for
    /// the homepage, each with its schedule, soonest first.
    async fn upcoming_trips(
        &self,
        today: &str,
    ) -> AppResult<Vec<(trip_session::Model, schedule::Model)>> {
        self.store
            .trip_store()
            .list_upcoming_trips(today, RECOMMENDATION_CANDIDATES)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Self-healing homepage: when no upcoming trip exists at all, fill
    /// the next 7 days from every schedule — bounded by the inline budget,
    /// today first. The background warmer (notified for the full sell
    /// window) owns the bulk work; without it the carousel would still
    /// empty on a cold database until a search happened.
    async fn fill_cold_database(&self) {
        let Ok(all_schedules) = self
            .store
            .schedule_store()
            .list_all_schedules(trip_warmer::SCHEDULE_SCAN_LIMIT)
            .await
        else {
            return;
        };
        let today = trip_time::local_today();
        let deadline = Some(std::time::Instant::now() + trip_warmer::INLINE_FILL_BUDGET);
        for date in trip_warmer::sell_window(&today, 7) {
            let _ = self
                .warmer
                .try_fill(self.store.as_ref(), &all_schedules, &date, deadline)
                .await;
            if deadline.is_some_and(|dl| std::time::Instant::now() >= dl) {
                break;
            }
        }
        for date in trip_warmer::sell_window(&today, trip_warmer::SELL_WINDOW_DAYS) {
            self.warmer.notify(&date);
        }
    }

    // ── Stats ───────────────────────────────────────────────────

    /// Public stats for the homepage: active brands and routes, and the
    /// scheduled trips departing today (Vietnam) or later.
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
            .count_upcoming_trips(&trip_time::local_today())
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

/// Trips the homepage shows, and how many upcoming ones it looks at to find
/// them (some may have left already today).
const RECOMMENDATIONS: usize = 4;
const RECOMMENDATION_CANDIDATES: u64 = 16;

/// Still on sale: scheduled and not yet departed.
pub(crate) fn on_sale(trip: &trip_session::Model, schedule: &schedule::Model) -> bool {
    trip.status == "scheduled"
        && !trip_time::departure_instant(
            &trip.departure_date,
            &schedule.departure_time,
            trip.actual_departure_at.as_deref(),
        )
        .is_some_and(|departs| departs <= chrono::Utc::now())
}

/// The seats of one class on a trip, for the fare legend.
struct FareSummary {
    fare: Fare,
    /// Cheapest seat for sale, else cheapest seat.
    cheapest_available: Option<i64>,
    cheapest: i64,
    seats: i64,
    available: i64,
}

impl FareSummary {
    fn new(fare: Fare) -> Self {
        Self {
            fare,
            cheapest_available: None,
            cheapest: i64::MAX,
            seats: 0,
            available: 0,
        }
    }

    fn add(&mut self, price: i64, available: bool) {
        self.seats += 1;
        self.cheapest = self.cheapest.min(price);
        if available {
            self.available += 1;
            self.cheapest_available = Some(self.cheapest_available.map_or(price, |c| c.min(price)));
        }
    }
}

/// One entry per seat class on the trip, cheapest first.
fn trip_fares(
    classes: BTreeMap<String, FareSummary>,
    policy: Option<ChildPolicy>,
) -> Vec<TripFare> {
    let mut out: Vec<TripFare> = classes
        .into_iter()
        .map(|(seat_class, s)| {
            let price_adult = s.cheapest_available.unwrap_or(s.cheapest);
            TripFare {
                seat_class,
                price_adult,
                price_child: fares::child_price(price_adult, s.fare, policy),
                seats: s.seats,
                available: s.available,
            }
        })
        .collect();
    out.sort_by_key(|f| f.price_adult);
    out
}

/// What a child pays for a standard seat; 0 without child tickets.
pub(crate) fn standard_child_price(schedule: &schedule::Model, policy: Option<ChildPolicy>) -> i64 {
    let fare = Fare {
        adult: schedule.base_price_adult,
        child: schedule.base_price_child,
    };
    fares::child_price(fare.adult, fare, policy).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bare-minimum schedule model for tests — only the
    /// effective-window + days-of-week fields matter.
    fn sched(
        effective_from: Option<&str>,
        effective_to: Option<&str>,
        days_of_week: Option<&str>,
    ) -> schedule::Model {
        schedule::Model {
            id: Uuid::new_v4(),
            route_id: Uuid::new_v4(),
            departure_time: "08:00".into(),
            effective_from: effective_from.map(String::from),
            effective_to: effective_to.map(String::from),
            days_of_week: days_of_week.map(String::from),
            bus_layout_id: None,
            base_price_adult: 100_000,
            base_price_child: None,
            amenities: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            vehicle_type_id: None,
        }
    }

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
    fn an_amenity_without_a_label_is_labelled_by_its_key() {
        assert_eq!(amenity_label("wifi"), "WiFi");
        assert_eq!(amenity_label("jacuzzi"), "jacuzzi");
    }

    #[test]
    fn stops_are_paired_in_order_and_unlimited_distance_keeps_the_nearest() {
        let stop = |order, lat, lon| StopHit {
            order,
            name: format!("stop {order}"),
            time: None,
            lat,
            lon,
        };
        let hits = [stop(1, 21.14, 105.5), stop(2, 10.95, 106.82)];
        let (from, to) = ((21.03, 105.85), (10.78, 106.7));
        // 36 km and 23 km away: out of reach for 10 km, kept without a limit.
        assert!(nearest_pair(&hits, from, to, 10.0).is_none());
        let (pickup, dropoff) = nearest_pair(&hits, from, to, f64::INFINITY).expect("a pair");
        assert_eq!(
            (pickup.name.as_str(), dropoff.name.as_str()),
            ("stop 1", "stop 2")
        );
        // The bus does not go the other way.
        assert!(nearest_pair(&hits, from, to, 40.0).is_some());
        assert!(nearest_pair(&hits, to, from, 40.0).is_none());
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
        let (dep, arr) = compute_iso_timestamps(&Some("2026-08-05".into()), &Some("08:30".into()));
        assert_eq!(dep.as_deref(), Some("2026-08-05T08:30:00"));
        assert_eq!(arr, None);
    }

    #[test]
    fn compute_iso_timestamps_handles_missing_time() {
        let (dep, arr) = compute_iso_timestamps(&Some("2026-08-05".into()), &None);
        // Falls back to the time part embedded in the date string.
        // Since "2026-08-05" has no time part, both are None.
        assert_eq!(dep, None);
        assert_eq!(arr, None);
    }

    #[test]
    fn compute_arrival_iso_same_day() {
        let iso = compute_arrival_iso("2026-08-05", "08:30", "14:45");
        assert_eq!(iso.as_deref(), Some("2026-08-05T14:45:00"));
    }

    #[test]
    fn compute_arrival_iso_overnight_rolls_one_day() {
        // Departure 22:00, last-stop arrival 06:00 → next calendar day.
        let iso = compute_arrival_iso("2026-08-05", "22:00", "06:00");
        assert_eq!(iso.as_deref(), Some("2026-08-06T06:00:00"));
        // Equality (a degenerate 24h trip) also rolls — the arrival is
        // unambiguously AFTER the departure either way.
        let iso = compute_arrival_iso("2026-12-31", "23:30", "23:30");
        assert_eq!(iso.as_deref(), Some("2027-01-01T23:30:00"));
    }

    #[test]
    fn compute_arrival_iso_rejects_garbage() {
        assert_eq!(
            compute_arrival_iso("2026-08-05", "08:30", "not-a-time"),
            None
        );
        assert_eq!(compute_arrival_iso("garbage", "08:30", "14:45"), None);
    }

    #[test]
    fn only_scheduled_trips_that_have_not_left_are_on_sale() {
        let schedule = sched(None, None, None);
        let trip = |days: i64, status: &str| trip_session::Model {
            id: Uuid::new_v4(),
            schedule_id: schedule.id,
            departure_date: (chrono::Utc::now() + chrono::Duration::days(days))
                .format("%Y-%m-%d")
                .to_string(),
            actual_departure_at: None,
            driver_name: None,
            driver_phone: None,
            status: status.into(),
            total_seats: 9,
            available_seats: 9,
            created_at: String::new(),
            updated_at: String::new(),
        };
        assert!(on_sale(&trip(2, "scheduled"), &schedule));
        assert!(!on_sale(&trip(-1, "scheduled"), &schedule));
        assert!(!on_sale(&trip(2, "cancelled"), &schedule));
    }
}
