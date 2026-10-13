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

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use uuid::Uuid;

use crate::dto::public::{
    BrandDetailOut, BrandListResponse, BrandOut, RouteBrandPreview, RouteEndpoint,
    RouteListResponse, RouteOut, StatsResponse, TripAmenity, TripBrandDetail, TripBusLayout,
    TripCore, TripDeckPlan, TripDetail, TripEndpoint, TripFare, TripPickupPoint, TripPricing,
    TripResult, TripRouteDetail, TripSchedulePoint, TripSearchResponse, TripSeat, TripSeatDeck,
    TripSeatMap, TripSeatRow,
};
use crate::entity::{
    brand, bus_layout, route, schedule, seat_inventory, trip_session, vehicle_type,
};
use crate::error::{AppError, AppResult};
use crate::service::fares::{self, ChildPolicy, Fare, FareTable};
use crate::service::place_service::haversine_km;
use crate::service::seat_plan;
use crate::service::trip_warmer;
use crate::service::{trip_stops, trip_time};
use crate::store::CompositeStore;
use crate::store::PickupPointWithRoute;

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

/// Resolve a schedule's vehicle class into `(code, label)`:
/// 1. the schedule's explicit `vehicle_type_id` (admin-managed catalog),
/// 2. the bus layout's legacy `vehicle_type` string,
/// 3. `standard` as the default.
///
/// Legacy codes get their label from the catalog when one matches
/// (e.g. a bus layout still saying `limousine`), else the static map.
fn resolve_vehicle_type(
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
/// Minutes-since-midnight of a trip's departure, for sorting.
///
/// Prefers the schedule's `HH:mm` string; falls back to the ISO
/// `departure_at`. Unparseable/missing values sort last (i32::MAX) so
/// incomplete data never shadows complete data.
/// The search form's optional "leaving after" time (`HH:MM`) in minutes
/// past midnight; `None` when absent or blank.
fn parse_depart_after(value: Option<&str>) -> AppResult<Option<i32>> {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let invalid = || AppError::BadRequest("departAfter must be HH:MM".into());
    let (h, m) = v.split_once(':').ok_or_else(invalid)?;
    let (h, m): (i32, i32) = (
        h.parse().map_err(|_| invalid())?,
        m.parse().map_err(|_| invalid())?,
    );
    if !(0..24).contains(&h) || !(0..60).contains(&m) {
        return Err(invalid());
    }
    Ok(Some(h * 60 + m))
}

fn departure_minutes(t: &TripResult) -> i32 {
    let src = t
        .departure_time
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(t.departure_at.as_deref());
    let Some(s) = src else { return i32::MAX };
    // Take "HH:mm" from the front — works for both "08:30" and
    // "2026-01-02T08:30:00" (the time follows the last 'T').
    let hm = s.rsplit('T').next().unwrap_or(s);
    let mut parts = hm.split(':');
    let h: i32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(-1);
    let m: i32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(-1);
    if h < 0 || m < 0 {
        i32::MAX
    } else {
        h * 60 + m
    }
}

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

/// Build the trip's arrival ISO timestamp from its departure date, the
/// schedule's departure time and the last stop's arrival time
/// (admin-configured `HH:MM`, validated on write). If the arrival
/// clock time is not after the departure clock time the trip crosses
/// midnight, so the calendar day rolls over +1 — this is what lets the
/// client flag "overnight" and show the correct arrival date. Returns
/// `None` when the schedule has no arrival times configured at all
/// (the frontend shows an honest "view detail" hint for that gap).
fn compute_arrival_iso(
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
                // Resolve endpoints from the route's STRUCTURED city
                // slugs (the admin form's canonical pick) — not by
                // splitting the free-text route name. Falls back to the
                // legacy "A → B" name-split for rows whose slugs don't
                // resolve (corrupt data), so something always renders.
                let (from_name, to_name) = (
                    crate::cities::name_for_slug(&r.start_location_id),
                    crate::cities::name_for_slug(&r.end_location_id),
                );
                let (from_name, to_name) =
                    if from_name == r.start_location_id && to_name == r.end_location_id {
                        r.name
                            .split_once(" → ")
                            .map(|(f, t)| (f.to_string(), t.to_string()))
                            .unwrap_or_else(|| (r.name.clone(), String::new()))
                    } else {
                        (from_name, to_name)
                    };

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
                        lat: 0.0,
                        lon: 0.0,
                    },
                    to: RouteEndpoint {
                        name: to_name,
                        lat: 0.0,
                        lon: 0.0,
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

    /// Search trips by from/to/date with optional vehicle-type filter.
    ///
    /// Read-first: the query loads existing trips BEFORE any fill; only
    /// schedules that are actually missing get materialized — bounded,
    /// off the request path when possible (see `fill_trips_inline` and
    /// [`trip_warmer`]). In the steady state (the warmer has the sell
    /// window covered) this is a handful of indexed queries and zero
    /// writes; price ranges load for just the returned page unless the
    /// sort itself needs them.
    #[allow(clippy::too_many_arguments)]
    pub async fn search_trips(
        &self,
        from: &str,
        to: &str,
        date: &str,
        limit: u64,
        offset: u64,
        vehicle_types: Vec<String>,
        sort: &str,
        min_seats: i64,
        depart_after: Option<&str>,
    ) -> AppResult<TripSearchResponse> {
        let depart_after = parse_depart_after(depart_after)?;
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
        let sort_key = if sort.is_empty() { "departure" } else { sort };
        let min_seats = min_seats.max(1);

        // SQL-side route search — two OR'd strategies:
        // 1. Name path: `LOWER(name) LIKE '%from%' AND LOWER(name) LIKE '%to%'`.
        // 2. Slug path: the query is resolved to city slugs
        //    (`cities::match_city_slugs` handles diacritics + colloquial
        //    aliases like "Sài Gòn" → `ho-chi-minh`) and matched against
        //    the route's structured `start_location_id`/`end_location_id`.
        //    This is what makes search find trips for users who type a
        //    city name that doesn't literally appear in the route name.
        let from_lower = from.to_lowercase();
        let to_lower = to.to_lowercase();
        let from_slugs: Vec<String> = crate::cities::match_city_slugs(from)
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let to_slugs: Vec<String> = crate::cities::match_city_slugs(to)
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let matching_routes = self
            .store
            .route_store()
            .search_active_routes(&from_lower, &to_lower, &from_slugs, &to_slugs, 1000)
            .await?;

        if matching_routes.is_empty() {
            return Ok(TripSearchResponse::paged_empty(limit, offset));
        }

        let route_uuids: Vec<Uuid> = matching_routes.iter().map(|r| r.id).collect();

        // Find schedules for these routes
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // READ the trips that already exist BEFORE any fill — indexed
        // and cheap, and the basis for the in-memory gap detection
        // below. (The old flow materialized unconditionally BEFORE
        // reading, which put a per-schedule write loop on the read path
        // — the 2026-10-11 outage.)
        //
        // SORTING CONTRACT: fetch a wider page than `limit` because the
        // sort happens AFTER two Rust-side stages — the vehicle-type
        // filter (drops rows the SQL can't see) and the comparator
        // below. Fetching exactly `limit` rows in DB order would make
        // `sort=price` rank only the first-N-by-insertion, silently
        // hiding cheaper trips. 500 is plenty for a day's departures on
        // a from/to pair; the final truncate enforces the real limit.
        let fetch_cap: u64 = 500;
        let schedule_uuids: Vec<Uuid> = schedules.iter().map(|s| s.id).collect();
        let mut trips = self
            .store
            .trip_store()
            .list_trips_by_schedule_ids(schedule_uuids.clone(), date, min_seats, fetch_cap)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // ── Gap detection + bounded inline fill ──────────────────────
        // Missing = schedules that run on the date but have no trip row
        // yet — computed from data already in hand (no extra query). A
        // cold date self-serves immediately (see `fill_trips_inline`);
        // a warmed date — the steady state — fills nothing.
        let today = trip_warmer::vn_today(chrono::Utc::now());
        if let (Some(parsed_date), true) = (
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok(),
            date >= today.as_str(),
        ) {
            let have: std::collections::HashSet<Uuid> =
                trips.iter().map(|t| t.schedule_id).collect();
            let missing: Vec<schedule::Model> = schedules
                .iter()
                .filter(|s| trip_warmer::schedule_runs_on(s, parsed_date))
                .filter(|s| !have.contains(&s.id))
                .cloned()
                .collect();
            if !missing.is_empty() {
                self.fill_trips_inline(&missing, date).await;
                // Pick up whatever the fill just wrote (a skipped or
                // partially-budgeted fill still serves existing rows).
                trips = self
                    .store
                    .trip_store()
                    .list_trips_by_schedule_ids(schedule_uuids, date, min_seats, fetch_cap)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
            }
        }

        // Price ranges: only `sort=price` needs the full candidate set —
        // every other sort prices JUST the returned page further down
        // (one indexed query over ≤ limit trips instead of ≤ 500 — the
        // single heaviest read in the search on a big seat-inventory
        // table). Items are built with the schedule base fare in the
        // meantime, which is exactly `CardPrices::of`'s fallback for
        // trips without seat inventory.
        let full_ranges = if sort_key == "price" {
            self.price_ranges(trips.iter().map(|t| t.id).collect())
                .await?
        } else {
            HashMap::new()
        };

        // Maps from data already in hand — the old code re-fetched the
        // schedules and routes it had just loaded (two extra queries
        // per search).
        let sched_map: HashMap<Uuid, &schedule::Model> =
            schedules.iter().map(|s| (s.id, s)).collect();
        let route_map: HashMap<Uuid, &route::Model> =
            matching_routes.iter().map(|r| (r.id, r)).collect();

        let route_brand_uuids: Vec<Uuid> =
            matching_routes.iter().filter_map(|r| r.brand_id).collect();
        let brand_map: HashMap<Uuid, brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(route_brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id, b))
            .collect();

        // Fetch bus layouts for vehicle type filtering — one batched
        // query (the old code fetched them one-by-one).
        let bus_layout_uuids: Vec<Uuid> =
            schedules.iter().filter_map(|s| s.bus_layout_id).collect();
        let layout_map: HashMap<Uuid, bus_layout::Model> = self
            .store
            .schedule_store()
            .list_bus_layouts_by_ids(bus_layout_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|l| (l.id, l))
            .collect();

        // Batch-load the schedules' explicit vehicle types (the
        // admin-managed catalog) — `resolve_vehicle_type` prefers them
        // over the bus-layout fallback.
        let vt_map: HashMap<Uuid, vehicle_type::Model> = {
            let ids: Vec<Uuid> = schedules.iter().filter_map(|s| s.vehicle_type_id).collect();
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

        // Resolve start/end location slugs to city records via the
        // hardcoded city table (no DB round-trip) — see `find_by_slug`
        // for the data-corruption fallback.
        let place_map: std::collections::HashMap<&str, &crate::cities::City> = route_map
            .values()
            .flat_map(|r| [r.start_location_id.as_str(), r.end_location_id.as_str()])
            .filter_map(|slug| crate::cities::find_by_slug(slug).map(|c| (c.slug, c)))
            .collect();

        // Batch-load the schedules' stop timetables — the LAST stop's
        // arrival time becomes the trip's `arrival_at` so the result
        // cards show real "start city + start time / end city + end
        // time" pairs instead of a destination name with no time.
        // Rows arrive ordered by stop_order asc, so inserting only on
        // non-empty times leaves each schedule's LATEST timed stop in
        // the map (a trailing stop without a time falls back to the
        // previous one that has it).
        let schedule_point_rows = self
            .store
            .address_store()
            .list_points_by_schedules(schedules.iter().map(|s| s.id).collect::<Vec<Uuid>>())
            .await
            .unwrap_or_default();
        let mut arrival_map: std::collections::HashMap<Uuid, String> =
            std::collections::HashMap::new();
        for p in &schedule_point_rows {
            if let Some(t) = p.arrival_time.as_deref().filter(|t| !t.is_empty()) {
                arrival_map.insert(p.schedule_id, t.to_string());
            }
        }

        // Build trip results
        let items: Vec<TripResult> = trips
            .iter()
            .filter_map(|t| {
                let sched = *sched_map.get(&t.schedule_id)?;
                let route = *route_map.get(&sched.route_id)?;
                if !on_sale(t, sched) {
                    return None;
                }
                let brand = route.brand_id.and_then(|bid| brand_map.get(&bid));
                let prices = CardPrices::of(&full_ranges, t.id, sched, brand);
                let layout = sched.bus_layout_id.and_then(|lid| layout_map.get(&lid));

                // Vehicle type: schedule catalog row first, bus-layout
                // fallback, "standard" default — then the filter.
                let (vehicle_type, vt_label) = resolve_vehicle_type(sched, layout, &vt_map);
                if !vehicle_types.is_empty() && !vehicle_types.contains(&vehicle_type) {
                    return None;
                }

                let from_place = place_map.get(route.start_location_id.as_str());
                let to_place = place_map.get(route.end_location_id.as_str());

                let amenities = parse_amenities(&sched.amenities);
                let (dep_iso, _) = compute_iso_timestamps(
                    &Some(t.departure_date.clone()),
                    &Some(sched.departure_time.clone()),
                );
                // Real arrival from the last configured stop; overnight
                // crossings roll the date +1 inside compute_arrival_iso.
                let arr_iso = arrival_map
                    .get(&sched.id)
                    .filter(|t| !t.is_empty())
                    .and_then(|hhmm| {
                        compute_arrival_iso(&t.departure_date, &sched.departure_time, hhmm)
                    });

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
                    brand_rating: brand.and_then(|b| b.rating),
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
                    min_price: prices.min,
                    max_price: prices.max,
                    price_adult: sched.base_price_adult,
                    price_child: prices.child,
                    vehicle_type,
                    vehicle_type_label: vt_label,
                    capacity: layout.and_then(|l| l.total_seats),
                    amenities,
                })
            })
            .collect();

        // ── Sort (server-side, the REAL implementation) ─────────────
        //
        // `sort` used to be parsed into `_sort` and silently ignored —
        // the UI offered price/rating sorts that did nothing. Now the
        // fetched page (see the fetch_cap note above) is sorted by the
        // requested key with deterministic tie-breaks (departure time,
        // then trip_id), then sliced to the requested page.
        //
        // The trip_id tie-break is what makes OFFSET pagination stable:
        // two trips with the same price AND departure time must always
        // land in the same relative order across pages, otherwise
        // "load more" could skip or duplicate rows at page seams.
        //
        // No "duration" key: the schedule model has no arrival time,
        // so trip duration is genuinely unknowable — the frontend no
        // longer offers that option rather than pretending to sort by
        // it.
        let mut items = items;
        match sort_key {
            "price" => items.sort_by(|a, b| {
                a.min_price
                    .cmp(&b.min_price)
                    .then_with(|| departure_minutes(a).cmp(&departure_minutes(b)))
                    .then_with(|| a.trip_id.cmp(&b.trip_id))
            }),
            "rating" => items.sort_by(|a, b| {
                b.brand_rating
                    .partial_cmp(&a.brand_rating)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| departure_minutes(a).cmp(&departure_minutes(b)))
                    .then_with(|| a.trip_id.cmp(&b.trip_id))
            }),
            _ => items.sort_by(|a, b| {
                departure_minutes(a)
                    .cmp(&departure_minutes(b))
                    .then_with(|| a.trip_id.cmp(&b.trip_id))
            }),
        }

        // "Leaving after" (the search form's optional time) narrows the day.
        if let Some(after) = depart_after {
            items.retain(|t| departure_minutes(t) >= after);
        }

        // ── Paginate ───────────────────────────────────────────────
        // `total` counts every matching trip BEFORE the offset window
        // is applied (capped by fetch_cap upstream); `has_more` is
        // derived from it so the client's "load more" button never has
        // to guess from an empty page.
        let total = items.len() as u64;
        let mut page: Vec<TripResult> = items
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .collect();

        // ── Page-level price fill ───────────────────────────────────
        // The non-price sorts didn't need full-candidate price ranges;
        // overwrite the base-fare placeholders with the real
        // for-sale ranges for JUST this page.
        if sort_key != "price" && !page.is_empty() {
            let page_ranges = self
                .price_ranges(page.iter().map(|t| t.trip_id).collect())
                .await?;
            for item in &mut page {
                if let Some(&(min, max)) = page_ranges.get(&item.trip_id) {
                    item.min_price = min;
                    item.max_price = max;
                }
            }
        }

        Ok(TripSearchResponse::paged(page, total, limit, offset))
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
    /// - `limit, offset` — pagination over the distance-ranked TRIP list
    ///   (a route with 3 schedules that day contributes 3 ranked items)
    /// - `min_seats` — minimum available seats (default 1)
    /// - `vehicle_types` — filter by vehicle type (empty = all)
    /// - `max_distance_km` — max distance from desired pickup/drop to
    ///   nearest route stop (default 50 km). Routes with no stop within
    ///   this radius are excluded.
    #[allow(clippy::too_many_arguments)] // geo search has an inherently wide signature
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
        depart_after: Option<&str>,
    ) -> AppResult<TripSearchResponse> {
        let depart_after = parse_depart_after(depart_after)?;
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
                from_lat - lat_delta,
                from_lat + lat_delta,
                from_lon - lon_delta,
                from_lon + lon_delta,
                to_lat - lat_delta,
                to_lat + lat_delta,
                to_lon - to_lon_delta,
                to_lon + to_lon_delta,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if candidates.is_empty() {
            return Ok(TripSearchResponse::paged_empty(limit, offset));
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
        #[allow(dead_code)] // debug fields kept for future diagnostics
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
                    if dist <= max_dist && (best_pickup.is_none() || dist < best_pickup.unwrap().1)
                    {
                        best_pickup = Some((p, dist));
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
                    if dist <= max_dist && (best_drop.is_none() || dist < best_drop.unwrap().1) {
                        best_drop = Some((p, dist));
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
            return Ok(TripSearchResponse::paged_empty(limit, offset));
        }

        // Sort routes by combined distance (closest first) — the RANK
        // every trip on that route inherits in the final list.
        matches.sort_by(|a, b| {
            a.combined_distance_km
                .partial_cmp(&b.combined_distance_km)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.route_id.cmp(&b.route_id))
        });

        // Load schedules + trips for ALL matched routes — pagination
        // happens at the TRIP level further down. The old route-level
        // skip/take produced short or EMPTY pages whenever a route page
        // had no trips on the date (a whole page of routes with zero
        // departures read as "no more results" while trips remained).
        let route_uuids: Vec<Uuid> = matches.iter().map(|m| m.route_id).collect();
        let schedules = self
            .store
            .schedule_store()
            .list_schedules_by_routes(route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if schedules.is_empty() {
            return Ok(TripSearchResponse::paged_empty(limit, offset));
        }

        // READ first, then fill only the gaps — same read-first contract
        // as the text search (see `search_trips`): the steady state is
        // pure indexed reads; a cold date self-serves under the bounded
        // inline budget while the background warmer catches up.
        let schedule_uuids: Vec<Uuid> = schedules.iter().map(|s| s.id).collect();
        let mut trips = self
            .store
            .trip_store()
            .list_trips_by_schedule_ids(schedule_uuids.clone(), date, min_seats, 1000)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let today = trip_warmer::vn_today(chrono::Utc::now());
        if let (Some(parsed_date), true) = (
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok(),
            date >= today.as_str(),
        ) {
            let have: std::collections::HashSet<Uuid> =
                trips.iter().map(|t| t.schedule_id).collect();
            let missing: Vec<schedule::Model> = schedules
                .iter()
                .filter(|s| trip_warmer::schedule_runs_on(s, parsed_date))
                .filter(|s| !have.contains(&s.id))
                .cloned()
                .collect();
            if !missing.is_empty() {
                self.fill_trips_inline(&missing, date).await;
                trips = self
                    .store
                    .trip_store()
                    .list_trips_by_schedule_ids(schedule_uuids, date, min_seats, 1000)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
            }
        }

        if trips.is_empty() {
            return Ok(TripSearchResponse::paged_empty(limit, offset));
        }

        // Build schedule lookup: schedule_id → schedule
        let schedule_map: HashMap<Uuid, &crate::entity::schedule::Model> =
            schedules.iter().map(|s| (s.id, s)).collect();

        // Build route match lookup: route_id → RouteMatch
        let match_map: HashMap<Uuid, &RouteMatch> =
            matches.iter().map(|m| (m.route_id, m)).collect();

        // Build route lookup — the PickupPointWithRoute already has route_name
        // + brand_id, so we don't need to re-fetch routes. Use the candidate data.
        use std::collections::HashSet;
        let route_info_map: HashMap<Uuid, &PickupPointWithRoute> = matches
            .iter()
            .map(|m| {
                (m.route_id, {
                    // Find the first candidate that matches this route
                    candidates
                        .iter()
                        .find(|c| c.route_id == m.route_id)
                        .unwrap()
                })
            })
            .collect();

        // Build brand lookup — fetch by IDs using raw SQL
        let brand_ids: Vec<Uuid> = matches
            .iter()
            .filter_map(|m| m.brand_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
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

        // Batch-load the schedules' explicit vehicle types (see
        // `resolve_vehicle_type` — the catalog row wins over the
        // bus-layout fallback).
        let vt_map: HashMap<Uuid, vehicle_type::Model> = {
            let ids: Vec<Uuid> = schedule_map
                .values()
                .filter_map(|s| s.vehicle_type_id)
                .collect();
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

        // Resolve the matched routes' start/end cities — the result cards
        // show real city names ("Hà Nội → Đà Nẵng"), NOT the user's raw
        // search coordinates which used to leak into from_name/to_name.
        let geo_route_map: HashMap<Uuid, route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(matches.iter().map(|m| m.route_id).collect())
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|r| (r.id, r))
            .collect();
        let geo_city_map: std::collections::HashMap<&str, &crate::cities::City> = geo_route_map
            .values()
            .flat_map(|r| [r.start_location_id.as_str(), r.end_location_id.as_str()])
            .filter_map(|slug| crate::cities::find_by_slug(slug).map(|c| (c.slug, c)))
            .collect();

        // Last-stop arrival times per schedule (same rule as the text
        // search — see the arrival_map comment there).
        let geo_arrival_rows = self
            .store
            .address_store()
            .list_points_by_schedules(schedule_map.values().map(|s| s.id).collect::<Vec<Uuid>>())
            .await
            .unwrap_or_default();
        let mut geo_arrival_map: std::collections::HashMap<Uuid, String> =
            std::collections::HashMap::new();
        for p in &geo_arrival_rows {
            if let Some(t) = p.arrival_time.as_deref().filter(|t| !t.is_empty()) {
                geo_arrival_map.insert(p.schedule_id, t.to_string());
            }
        }

        // Build items WITH their route's proximity score — the final list
        // must rank TRIPS closest → least-close (a route with several
        // departures that day contributes one item per departure at the
        // route's rank; the old code iterated the DB-ordered trip list,
        // so the response wasn't actually distance-sorted despite the
        // matches being sorted).
        //
        // Prices: geo ALWAYS ranks by distance, so items are built with
        // the schedule base fare and the real for-sale ranges are filled
        // for just the returned PAGE below — one indexed query over
        // ≤ limit trips instead of the whole ≤ 1000-trip candidate set.
        let mut scored: Vec<(TripResult, f64)> = Vec::new();
        for trip in &trips {
            let schedule = match schedule_map.get(&trip.schedule_id) {
                Some(s) => *s,
                None => continue,
            };
            if !on_sale(trip, schedule) {
                continue;
            }
            let m = match match_map.get(&schedule.route_id) {
                Some(m) => *m,
                None => continue,
            };
            let route_info = match route_info_map.get(&schedule.route_id) {
                Some(r) => *r,
                None => continue,
            };

            // Vehicle type filter (schedule catalog row first, bus-layout
            // fallback, "standard" default — same as the text search).
            let (vehicle_type, vt_label) = resolve_vehicle_type(schedule, None, &vt_map);
            if !vehicle_types.is_empty() && !vehicle_types.contains(&vehicle_type) {
                continue;
            }

            let brand = m.brand_id.and_then(|bid| brand_map.get(&bid)).cloned();

            // Route's own start/end cities (fall back to the raw
            // coordinates only when the slug doesn't resolve — data
            // corruption case, same contract as the text search).
            let route_model = geo_route_map.get(&schedule.route_id);
            let from_city =
                route_model.and_then(|r| geo_city_map.get(r.start_location_id.as_str()));
            let to_city = route_model.and_then(|r| geo_city_map.get(r.end_location_id.as_str()));

            let amenities: Vec<String> = schedule
                .amenities
                .as_ref()
                .map(|a| {
                    a.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();

            let item = TripResult {
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
                brand_logo: brand
                    .and_then(|b| b.logo_url.clone())
                    .unwrap_or_default()
                    .into(),
                brand_rating: brand.and_then(|b| b.rating),
                from_name: from_city.map(|c| c.name.to_string()).unwrap_or_default(),
                from_lat: from_city.map(|c| c.lat).unwrap_or(from_lat),
                from_lon: from_city.map(|c| c.lon).unwrap_or(from_lon),
                to_name: to_city.map(|c| c.name.to_string()).unwrap_or_default(),
                to_lat: to_city.map(|c| c.lat).unwrap_or(to_lat),
                to_lon: to_city.map(|c| c.lon).unwrap_or(to_lon),
                departure_time: Some(schedule.departure_time.clone()),
                // Same computed departure as the text search (the
                // actual_departure_at live-tracking field stays null
                // until the bus physically departs).
                departure_at: compute_iso_timestamps(
                    &Some(trip.departure_date.clone()),
                    &Some(schedule.departure_time.clone()),
                )
                .0,
                arrival_at: geo_arrival_map
                    .get(&schedule.id)
                    .filter(|t| !t.is_empty())
                    .and_then(|hhmm| {
                        compute_arrival_iso(&trip.departure_date, &schedule.departure_time, hhmm)
                    }),
                bus_layout_id: schedule.bus_layout_id.map(|u| u.to_string()),
                // Base-fare placeholders — the page-level fill below
                // overwrites them with the real for-sale ranges
                // (identical fallback semantics to `CardPrices::of`).
                min_price: schedule.base_price_adult,
                max_price: schedule.base_price_adult,
                price_adult: schedule.base_price_adult,
                price_child: standard_child_price(schedule, brand.and_then(ChildPolicy::of)),
                vehicle_type,
                vehicle_type_label: vt_label,
                capacity: None,
                amenities,
            };
            scored.push((item, m.combined_distance_km));
        }

        // ── Rank + paginate (TRIP level) ───────────────────
        // Closest combined pickup+drop proximity first, then departure
        // time, then trip_id — the trip_id tie-break keeps OFFSET
        // pagination stable across pages (same contract as the text
        // search's sort).
        scored.sort_by(|x, y| {
            x.1.partial_cmp(&y.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| departure_minutes(&x.0).cmp(&departure_minutes(&y.0)))
                .then_with(|| x.0.trip_id.cmp(&y.0.trip_id))
        });

        if let Some(after) = depart_after {
            scored.retain(|(t, _)| departure_minutes(t) >= after);
        }
        let total = scored.len() as u64;
        let mut page: Vec<TripResult> = scored
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(|(item, _rank)| item)
            .collect();

        // ── Page-level price fill ───────────────────────────────────
        // Real for-sale ranges for just this page (see the scored-build
        // comment above).
        if !page.is_empty() {
            let page_ranges = self
                .price_ranges(page.iter().map(|t| t.trip_id).collect())
                .await?;
            for item in &mut page {
                if let Some(&(min, max)) = page_ranges.get(&item.trip_id) {
                    item.min_price = min;
                    item.max_price = max;
                }
            }
        }

        Ok(TripSearchResponse::paged(page, total, limit, offset))
    }

    /// Trip detail by id — full enriched TripDetail shape.
    /// Cheapest and dearest seat for sale on each of these trips.
    async fn price_ranges(&self, trip_ids: Vec<Uuid>) -> AppResult<HashMap<Uuid, (i64, i64)>> {
        self.store
            .trip_store()
            .available_price_ranges(trip_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))
    }

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
        let address_rows = if address_ids.is_empty() {
            Vec::new()
        } else {
            self.store
                .address_store()
                .list_addresses_by_ids(address_ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        };
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

    /// Recommended trips (up to 4) — upcoming trips with available seats.
    pub async fn recommendations(&self) -> AppResult<TripSearchResponse> {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let mut trips = self
            .store
            .trip_store()
            .list_upcoming_trips(&today, RECOMMENDATION_CANDIDATES)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Self-healing homepage: when no upcoming trips exist at all,
        // fill the next 7 days from every schedule — bounded by the
        // inline budget, today first — and re-query. The background
        // warmer (notified here for the full sell window) owns the bulk
        // work; without it the carousel would still empty on a cold
        // database until a search happened.
        if trips.is_empty() {
            if let Ok(all_schedules) = self
                .store
                .schedule_store()
                .list_all_schedules(trip_warmer::SCHEDULE_SCAN_LIMIT)
                .await
            {
                let today_vn = trip_warmer::vn_today(chrono::Utc::now());
                let deadline = Some(std::time::Instant::now() + trip_warmer::INLINE_FILL_BUDGET);
                for date in trip_warmer::sell_window(&today_vn, 7) {
                    let _ = self
                        .warmer
                        .try_fill(self.store.as_ref(), &all_schedules, &date, deadline)
                        .await;
                    if deadline.is_some_and(|dl| std::time::Instant::now() >= dl) {
                        break;
                    }
                }
                for date in trip_warmer::sell_window(&today_vn, trip_warmer::SELL_WINDOW_DAYS) {
                    self.warmer.notify(&date);
                }
            }
            trips = self
                .store
                .trip_store()
                .list_upcoming_trips(&today, RECOMMENDATION_CANDIDATES)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }

        // Reuse search_trips serialization logic
        let price_ranges = self
            .price_ranges(trips.iter().map(|t| t.id).collect())
            .await?;
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

            // Start/end city names (the homepage carousel cards used to
            // show blank cities) + last-stop arrival times.
            let place_map: std::collections::HashMap<&str, &crate::cities::City> = route_map
                .values()
                .flat_map(|r| [r.start_location_id.as_str(), r.end_location_id.as_str()])
                .filter_map(|slug| crate::cities::find_by_slug(slug).map(|c| (c.slug, c)))
                .collect();
            let sched_uuids: Vec<Uuid> = sched_map.values().map(|s| s.id).collect();
            let rec_arrival_rows = self
                .store
                .address_store()
                .list_points_by_schedules(sched_uuids)
                .await
                .unwrap_or_default();
            let mut rec_arrival_map: std::collections::HashMap<Uuid, String> =
                std::collections::HashMap::new();
            for p in &rec_arrival_rows {
                if let Some(t) = p.arrival_time.as_deref().filter(|t| !t.is_empty()) {
                    rec_arrival_map.insert(p.schedule_id, t.to_string());
                }
            }

            trips
                .iter()
                .filter_map(|t| {
                    let sched = sched_map.get(&t.schedule_id.to_string())?;
                    let route = route_map.get(&sched.route_id.to_string())?;
                    if !on_sale(t, sched) {
                        return None;
                    }
                    let brand = route
                        .brand_id
                        .map(|id| id.to_string())
                        .as_deref()
                        .and_then(|bid| brand_map.get(bid));
                    let prices = CardPrices::of(&price_ranges, t.id, sched, brand);
                    let amenities = parse_amenities(&sched.amenities);
                    let (dep_iso, _) = compute_iso_timestamps(
                        &Some(t.departure_date.clone()),
                        &Some(sched.departure_time.clone()),
                    );
                    let arr_iso = rec_arrival_map
                        .get(&sched.id)
                        .filter(|t| !t.is_empty())
                        .and_then(|hhmm| {
                            compute_arrival_iso(&t.departure_date, &sched.departure_time, hhmm)
                        });
                    let vehicle_type = "standard".to_string();
                    let vt_label = vehicle_type_label(&vehicle_type);
                    let from_city = place_map.get(route.start_location_id.as_str());
                    let to_city = place_map.get(route.end_location_id.as_str());

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
                        brand_rating: brand.and_then(|b| b.rating),
                        from_name: from_city.map(|c| c.name.to_string()).unwrap_or_default(),
                        from_lat: from_city.map(|c| c.lat).unwrap_or(0.0),
                        from_lon: from_city.map(|c| c.lon).unwrap_or(0.0),
                        to_name: to_city.map(|c| c.name.to_string()).unwrap_or_default(),
                        to_lat: to_city.map(|c| c.lat).unwrap_or(0.0),
                        to_lon: to_city.map(|c| c.lon).unwrap_or(0.0),
                        departure_time: Some(sched.departure_time.clone()),
                        departure_at: dep_iso,
                        arrival_at: arr_iso,
                        bus_layout_id: sched.bus_layout_id.map(|u| u.to_string()),
                        min_price: prices.min,
                        max_price: prices.max,
                        price_adult: sched.base_price_adult,
                        price_child: prices.child,
                        vehicle_type,
                        vehicle_type_label: vt_label.to_string(),
                        capacity: None,
                        amenities,
                    })
                })
                .take(RECOMMENDATIONS)
                .collect()
        };

        Ok(TripSearchResponse::unpaginated(items))
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
fn on_sale(trip: &trip_session::Model, schedule: &schedule::Model) -> bool {
    trip.status == "scheduled"
        && !trip_time::departure_instant(
            &trip.departure_date,
            &schedule.departure_time,
            trip.actual_departure_at.as_deref(),
        )
        .is_some_and(|departs| departs <= chrono::Utc::now())
}

/// Prices on a result card.
struct CardPrices {
    min: i64,
    max: i64,
    /// Standard-seat child price; 0 without child tickets.
    child: i64,
}

impl CardPrices {
    /// The range of seats still for sale; the base fare for trips without
    /// seat inventory.
    fn of(
        ranges: &HashMap<Uuid, (i64, i64)>,
        trip: Uuid,
        schedule: &schedule::Model,
        brand: Option<&brand::Model>,
    ) -> Self {
        let (min, max) = ranges
            .get(&trip)
            .copied()
            .unwrap_or((schedule.base_price_adult, schedule.base_price_adult));
        Self {
            min,
            max,
            child: standard_child_price(schedule, brand.and_then(ChildPolicy::of)),
        }
    }
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
fn standard_child_price(schedule: &schedule::Model, policy: Option<ChildPolicy>) -> i64 {
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
