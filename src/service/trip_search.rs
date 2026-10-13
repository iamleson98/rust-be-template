//! The shared half of trip search.
//!
//! The city search and the coordinate search find their candidate trips
//! differently (route endpoints vs. the stops nearest the customer), then
//! hand them to [`results`], which does the rest the same way for both:
//! builds the result cards, counts the filter options over every match,
//! applies the customer's filters, sorts and pages. All of it happens on
//! the server, so a filter sees every match — not just the page the
//! browser happens to have loaded.
//!
//! Cost: a fixed handful of batched, indexed queries per search, whatever
//! the number of matches (no per-trip queries). Seat prices come from the
//! seat rows of trips someone opened and from the fare table otherwise
//! (seats are created on demand — see `trip_warmer::ensure_seats`).

use std::collections::{BTreeSet, HashMap, HashSet};

use uuid::Uuid;

use super::public_service::{
    amenity_label, compute_arrival_iso, compute_iso_timestamps, on_sale, parse_amenities,
    resolve_vehicle_type, standard_child_price,
};
use crate::dto::public::{FacetCount, SearchFacets, TripResult, TripSearchResponse, TripStopMatch};
use crate::entity::{brand, route, schedule, trip_session};
use crate::error::{AppError, AppResult};
use crate::service::fares::{self, ChildPolicy, FareTable};
use crate::store::CompositeStore;

/// "Plenty of seats" means more than this many left.
pub const FEW_SEATS: i64 = 5;

/// Boarding hour bands of the time-of-day filter, `[start, end)`.
const HOUR_BANDS: [(&str, i32, i32); 4] = [
    ("0-6", 0, 6),
    ("6-12", 6, 12),
    ("12-18", 12, 18),
    ("18-24", 18, 24),
];

/// Bounded IN-lists.
const IN_CHUNK: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sort {
    /// Earliest boarding first.
    Departure,
    /// Cheapest seat first.
    Price,
    /// Best-rated operator first.
    Rating,
    /// Nearest pickup + drop-off first (coordinate search).
    Distance,
}

impl Sort {
    /// `sort` as sent; the coordinate search defaults to distance, the
    /// city search to departure.
    pub fn parse(sort: Option<&str>, coordinate_search: bool) -> Self {
        match sort.map(str::trim) {
            Some("price") => Self::Price,
            Some("rating") => Self::Rating,
            Some("departure") => Self::Departure,
            Some("distance") if coordinate_search => Self::Distance,
            _ if coordinate_search => Self::Distance,
            _ => Self::Departure,
        }
    }
}

/// The results page's filters.
#[derive(Debug, Clone, Default)]
pub struct Filters {
    pub vehicle_types: Vec<String>,
    /// Operator slugs.
    pub brands: Vec<String>,
    /// Bounds on a trip's cheapest seat for sale (VND).
    pub price_min: Option<i64>,
    pub price_max: Option<i64>,
    /// Boarding hour bands `[start, end)`.
    pub hours: Vec<(i32, i32)>,
    pub min_rating: Option<f64>,
    /// More than [`FEW_SEATS`] seats left.
    pub plenty_of_seats: bool,
    /// Amenity keys a trip must all have.
    pub amenities: Vec<String>,
}

fn csv(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

impl Filters {
    /// From the query string's raw values.
    #[allow(clippy::too_many_arguments)] // one argument per filter
    pub fn parse(
        vehicle_types: Option<&str>,
        brands: Option<&str>,
        price_min: Option<i64>,
        price_max: Option<i64>,
        hours: Option<&str>,
        min_rating: Option<f64>,
        plenty_of_seats: Option<bool>,
        amenities: Option<&str>,
    ) -> AppResult<Self> {
        let hours = csv(hours)
            .iter()
            .map(|band| {
                HOUR_BANDS
                    .iter()
                    .find(|(key, ..)| key == band)
                    .map(|(_, start, end)| (*start, *end))
                    .ok_or_else(|| {
                        AppError::BadRequest(format!(
                            "hours: unknown band {band:?} (use 0-6, 6-12, 12-18, 18-24)"
                        ))
                    })
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(Self {
            vehicle_types: csv(vehicle_types),
            brands: csv(brands),
            price_min: price_min.filter(|p| *p > 0),
            price_max: price_max.filter(|p| *p > 0),
            hours,
            min_rating: min_rating.filter(|r| *r > 0.0),
            plenty_of_seats: plenty_of_seats.unwrap_or(false),
            amenities: csv(amenities),
        })
    }
}

/// How a search is narrowed, sorted and paged.
#[derive(Debug, Clone)]
pub struct Options {
    /// `YYYY-MM-DD`.
    pub date: String,
    pub limit: u64,
    pub offset: u64,
    pub sort: Sort,
    pub min_seats: i64,
    /// Only trips boarding at or after this many minutes past midnight.
    pub depart_after: Option<i32>,
    pub filters: Filters,
}

impl Options {
    /// Validated options from the query string's values.
    pub fn new(
        date: &str,
        limit: Option<u64>,
        offset: Option<u64>,
        sort: Sort,
        min_seats: Option<i64>,
        depart_after: Option<&str>,
        filters: Filters,
    ) -> AppResult<Self> {
        let date = date.trim();
        if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err(AppError::BadRequest("date must be YYYY-MM-DD".into()));
        }
        Ok(Self {
            date: date.to_string(),
            limit: limit.unwrap_or(20).clamp(1, 100),
            offset: offset.unwrap_or(0),
            sort,
            min_seats: min_seats.unwrap_or(1).max(1),
            depart_after: parse_depart_after(depart_after)?,
            filters,
        })
    }
}

/// The search form's optional "leaving after" time (`HH:MM`) in minutes
/// past midnight; `None` when absent or blank.
fn parse_depart_after(value: Option<&str>) -> AppResult<Option<i32>> {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    minutes_of(v)
        .filter(|_| v.len() <= 5)
        .map(Some)
        .ok_or_else(|| AppError::BadRequest("departAfter must be HH:MM".into()))
}

/// A trip a search found, with where the customer boards and leaves it
/// when the search knows (coordinate search).
pub struct Candidate {
    pub trip: trip_session::Model,
    pub schedule: schedule::Model,
    pub route: route::Model,
    pub pickup: Option<TripStopMatch>,
    pub dropoff: Option<TripStopMatch>,
}

/// `HH:MM` → minutes past midnight.
pub(crate) fn minutes_of(hhmm: &str) -> Option<i32> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let (h, m): (i32, i32) = (h.parse().ok()?, m.get(..2).unwrap_or(m).parse().ok()?);
    ((0..24).contains(&h) && (0..60).contains(&m)).then_some(h * 60 + m)
}

/// When the customer boards, in minutes past midnight of the departure
/// day: at their pickup stop when the timetable says (past midnight when
/// the bus gets there after the day rolled over), else at departure.
fn boarding_minutes(c: &Candidate) -> i32 {
    let departs = minutes_of(&c.schedule.departure_time).unwrap_or(0);
    match c
        .pickup
        .as_ref()
        .and_then(|p| p.time.as_deref())
        .and_then(minutes_of)
    {
        Some(at) if at < departs => at + 24 * 60,
        Some(at) => at,
        None => departs,
    }
}

/// A card and what sorting needs about it.
struct Built {
    item: TripResult,
    boards_at: i32,
    /// Pickup + drop-off distance (km); none outside the coordinate search.
    distance: Option<f64>,
}

impl Built {
    fn boarding_hour(&self) -> i32 {
        (self.boards_at % (24 * 60)) / 60
    }

    fn keep(&self, f: &Filters) -> bool {
        let t = &self.item;
        (f.vehicle_types.is_empty() || f.vehicle_types.contains(&t.vehicle_type))
            && (f.brands.is_empty() || f.brands.contains(&t.brand_slug))
            && f.price_min.is_none_or(|p| t.min_price >= p)
            && f.price_max.is_none_or(|p| t.min_price <= p)
            && (f.hours.is_empty() || {
                let hour = self.boarding_hour();
                f.hours
                    .iter()
                    .any(|(start, end)| (*start..*end).contains(&hour))
            })
            && f.min_rating
                .is_none_or(|r| t.brand_rating.unwrap_or(0.0) >= r)
            && (!f.plenty_of_seats || t.available_seats > FEW_SEATS)
            && f.amenities.iter().all(|a| t.amenities.contains(a))
    }
}

/// Build, count, filter, sort and page `candidates`.
pub async fn results(
    store: &CompositeStore,
    candidates: Vec<Candidate>,
    opts: &Options,
) -> AppResult<TripSearchResponse> {
    let candidates: Vec<Candidate> = candidates
        .into_iter()
        .filter(|c| on_sale(&c.trip, &c.schedule))
        .filter(|c| {
            opts.depart_after
                .is_none_or(|after| boarding_minutes(c) >= after)
        })
        .collect();
    if candidates.is_empty() {
        return Ok(
            TripSearchResponse::paged_empty(opts.limit, opts.offset).with_facets(facets(&[]))
        );
    }

    let built = build(store, candidates).await?;
    let facets = facets(&built);
    let mut matches: Vec<Built> = built
        .into_iter()
        .filter(|b| b.keep(&opts.filters))
        .collect();
    sort(&mut matches, opts.sort);

    let total = matches.len() as u64;
    let page: Vec<TripResult> = matches
        .into_iter()
        .skip(opts.offset as usize)
        .take(opts.limit as usize)
        .map(|b| b.item)
        .collect();
    Ok(TripSearchResponse::paged(page, total, opts.limit, opts.offset).with_facets(facets))
}

fn internal(e: impl std::fmt::Display) -> AppError {
    AppError::Internal(e.to_string())
}

/// The cards, from a fixed number of batched queries.
async fn build(store: &CompositeStore, candidates: Vec<Candidate>) -> AppResult<Vec<Built>> {
    let schedule_ids: Vec<Uuid> = unique(candidates.iter().map(|c| c.schedule.id));
    let layout_ids: Vec<Uuid> = unique(candidates.iter().filter_map(|c| c.schedule.bus_layout_id));
    let vt_ids: Vec<Uuid> = unique(candidates.iter().filter_map(|c| c.schedule.vehicle_type_id));
    let brand_ids: Vec<Uuid> = unique(candidates.iter().filter_map(|c| c.route.brand_id));
    let trip_ids: Vec<Uuid> = candidates.iter().map(|c| c.trip.id).collect();

    let brands: HashMap<Uuid, brand::Model> = store
        .brand_store()
        .list_brands_by_ids(brand_ids)
        .await
        .map_err(internal)?
        .into_iter()
        .map(|b| (b.id, b))
        .collect();
    let layouts: HashMap<Uuid, _> = store
        .schedule_store()
        .list_bus_layouts_by_ids(layout_ids.clone())
        .await
        .map_err(internal)?
        .into_iter()
        .map(|l| (l.id, l))
        .collect();
    let vehicle_types: HashMap<Uuid, _> = if vt_ids.is_empty() {
        HashMap::new()
    } else {
        store
            .vehicle_type_store()
            .find_vehicle_types_by_ids(vt_ids)
            .await
            .map_err(internal)?
            .into_iter()
            .map(|v| (v.id, v))
            .collect()
    };

    // The last timed stop of each timetable is the arrival.
    let mut arrivals: HashMap<Uuid, String> = HashMap::new();
    for point in store
        .address_store()
        .list_points_by_schedules(schedule_ids.clone())
        .await
        .map_err(internal)?
    {
        if let Some(t) = point.arrival_time.filter(|t| !t.is_empty()) {
            arrivals.insert(point.schedule_id, t);
        }
    }

    // Prices: the seats for sale where a trip's seats exist (it was
    // opened), the fares of its layout's seat classes otherwise.
    let mut for_sale: HashMap<Uuid, (i64, i64)> = HashMap::new();
    for chunk in trip_ids.chunks(IN_CHUNK) {
        for_sale.extend(
            store
                .trip_store()
                .available_price_ranges(chunk.to_vec())
                .await
                .map_err(internal)?,
        );
    }
    let fare_rows = store
        .schedule_store()
        .list_fares(schedule_ids)
        .await
        .map_err(internal)?;
    let mut classes: HashMap<Uuid, BTreeSet<String>> = HashMap::new();
    if !layout_ids.is_empty() {
        for s in store
            .trip_store()
            .list_seats_by_layout_ids(layout_ids)
            .await
            .map_err(internal)?
        {
            classes
                .entry(s.bus_layout_id)
                .or_default()
                .insert(fares::class_of(&s));
        }
    }
    let fare_range = |s: &schedule::Model| -> (i64, i64) {
        let table = FareTable::new(s, &fare_rows);
        let prices: Vec<i64> = s
            .bus_layout_id
            .and_then(|l| classes.get(&l))
            .map(|cs| cs.iter().map(|c| table.fare(Some(c)).adult).collect())
            .unwrap_or_default();
        match (prices.iter().min(), prices.iter().max()) {
            (Some(&lo), Some(&hi)) => (lo, hi),
            _ => (s.base_price_adult, s.base_price_adult),
        }
    };

    Ok(candidates
        .into_iter()
        .map(|c| {
            let boards_at = boarding_minutes(&c);
            let distance = match (&c.pickup, &c.dropoff) {
                (Some(p), Some(d)) => Some(p.distance_km + d.distance_km),
                _ => None,
            };
            let Candidate {
                trip,
                schedule: s,
                route: r,
                pickup,
                dropoff,
            } = c;
            let brand = r.brand_id.and_then(|id| brands.get(&id));
            let layout = s.bus_layout_id.and_then(|id| layouts.get(&id));
            let (vehicle_type, vehicle_type_label) =
                resolve_vehicle_type(&s, layout, &vehicle_types);
            let (min_price, max_price) = for_sale
                .get(&trip.id)
                .copied()
                .unwrap_or_else(|| fare_range(&s));
            let from = crate::cities::find_by_slug(&r.start_location_id);
            let to = crate::cities::find_by_slug(&r.end_location_id);
            let (departure_at, _) = compute_iso_timestamps(
                &Some(trip.departure_date.clone()),
                &Some(s.departure_time.clone()),
            );
            let arrival_at = arrivals
                .get(&s.id)
                .and_then(|at| compute_arrival_iso(&trip.departure_date, &s.departure_time, at));
            let item = TripResult {
                trip_id: trip.id,
                schedule_id: s.id,
                departure_date: trip.departure_date,
                status: trip.status,
                available_seats: trip.available_seats,
                total_seats: trip.total_seats,
                route_id: r.id,
                route_name: r.name,
                brand_id: r.brand_id,
                brand_name: brand.map(|b| b.name.clone()).unwrap_or_default(),
                brand_slug: brand.map(|b| b.slug.clone()).unwrap_or_default(),
                brand_logo: brand.and_then(|b| b.logo_url.clone()),
                brand_rating: brand.and_then(|b| b.rating),
                from_name: from.map(|p| p.name.to_string()).unwrap_or_default(),
                from_lat: from.map(|p| p.lat).unwrap_or(0.0),
                from_lon: from.map(|p| p.lon).unwrap_or(0.0),
                to_name: to.map(|p| p.name.to_string()).unwrap_or_default(),
                to_lat: to.map(|p| p.lat).unwrap_or(0.0),
                to_lon: to.map(|p| p.lon).unwrap_or(0.0),
                departure_time: Some(s.departure_time.clone()),
                departure_at,
                arrival_at,
                bus_layout_id: s.bus_layout_id.map(|u| u.to_string()),
                min_price,
                max_price,
                price_adult: s.base_price_adult,
                price_child: standard_child_price(&s, brand.and_then(ChildPolicy::of)),
                vehicle_type,
                vehicle_type_label,
                capacity: layout.and_then(|l| l.total_seats),
                amenities: parse_amenities(&s.amenities),
                pickup,
                dropoff,
            };
            Built {
                item,
                boards_at,
                distance,
            }
        })
        .collect())
}

fn unique(ids: impl Iterator<Item = Uuid>) -> Vec<Uuid> {
    ids.collect::<HashSet<_>>().into_iter().collect()
}

/// Every filter option, counted over all matches.
fn facets(built: &[Built]) -> SearchFacets {
    let count = |pairs: Vec<(String, String)>| -> Vec<FacetCount> {
        let mut by_key: HashMap<String, FacetCount> = HashMap::new();
        for (key, label) in pairs.into_iter().filter(|(k, _)| !k.is_empty()) {
            by_key
                .entry(key.clone())
                .or_insert(FacetCount {
                    key,
                    label,
                    count: 0,
                })
                .count += 1;
        }
        let mut out: Vec<FacetCount> = by_key.into_values().collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
        out
    };
    let items = || built.iter().map(|b| &b.item);
    SearchFacets {
        matches: built.len() as u64,
        price_min: items().map(|t| t.min_price).min().unwrap_or(0),
        price_max: items().map(|t| t.max_price).max().unwrap_or(0),
        brands: count(
            items()
                .map(|t| {
                    let label = if t.brand_name.is_empty() {
                        t.brand_slug.clone()
                    } else {
                        t.brand_name.clone()
                    };
                    (t.brand_slug.clone(), label)
                })
                .collect(),
        ),
        vehicle_types: count(
            items()
                .map(|t| (t.vehicle_type.clone(), t.vehicle_type_label.clone()))
                .collect(),
        ),
        hours: HOUR_BANDS
            .iter()
            .map(|(key, start, end)| FacetCount {
                key: (*key).to_string(),
                label: (*key).to_string(),
                count: built
                    .iter()
                    .filter(|b| (*start..*end).contains(&b.boarding_hour()))
                    .count() as u64,
            })
            .collect(),
        amenities: count(
            items()
                .flat_map(|t| t.amenities.iter())
                .map(|a| (a.clone(), amenity_label(a).to_string()))
                .collect(),
        ),
        plenty_of_seats: items().filter(|t| t.available_seats > FEW_SEATS).count() as u64,
    }
}

/// Deterministic order: the key, then boarding time, then trip id (stable
/// OFFSET paging — equal keys never swap between pages).
fn sort(matches: &mut [Built], by: Sort) {
    use std::cmp::Ordering;
    let tail = |a: &Built, b: &Built| {
        a.boards_at
            .cmp(&b.boards_at)
            .then_with(|| a.item.trip_id.cmp(&b.item.trip_id))
    };
    matches.sort_by(|a, b| match by {
        Sort::Departure => tail(a, b),
        Sort::Price => a
            .item
            .min_price
            .cmp(&b.item.min_price)
            .then_with(|| tail(a, b)),
        Sort::Rating => {
            let rating = |x: &Built| x.item.brand_rating.unwrap_or(-1.0);
            rating(b)
                .partial_cmp(&rating(a))
                .unwrap_or(Ordering::Equal)
                .then_with(|| tail(a, b))
        }
        Sort::Distance => {
            let d = |x: &Built| x.distance.unwrap_or(f64::MAX);
            d(a).partial_cmp(&d(b))
                .unwrap_or(Ordering::Equal)
                .then_with(|| tail(a, b))
        }
    });
}
