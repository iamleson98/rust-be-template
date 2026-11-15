//! A brand's public page in one read — `GET /api/brands/{slug}/profile`.
//!
//! Everything the page shows comes from here: who the brand is, where it
//! has offices and stops, the routes it runs with their timetables, and
//! the trips about to leave. Every figure is read, never estimated: a
//! route with no schedule has no price, a brand with no review has no
//! rating. The page never creates trips (the warmer does).

use std::cmp::Ordering;
use std::collections::HashMap;

use chrono::NaiveDate;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::dto::public::{
    BrandProfile, ProfileBrand, ProfileLocation, ProfileRoute, ProfileSchedule, ProfileTrip,
    RouteEndpoint,
};
use crate::entity::{address, schedule};
use crate::error::{AppError, AppResult};
use crate::service::public_service::{city_point, endpoint_names, on_sale};
use crate::service::trip_time;
use crate::store::{CompositeStore, StoreError};

/// Days of departures the page lists, today included.
pub const UPCOMING_DAYS: i64 = 3;
/// Most trips the page lists.
pub const UPCOMING_TRIP_CAP: usize = 40;
/// Most locations the page lists.
pub const LOCATION_CAP: u64 = 60;

fn internal(e: StoreError) -> AppError {
    AppError::Internal(e.to_string())
}

/// The page of the active brand `slug`; not found for an unknown or
/// inactive brand.
pub async fn get(store: &CompositeStore, slug: &str) -> AppResult<BrandProfile> {
    let brand = store
        .brand_store()
        .get_by_slug(slug)
        .await
        .map_err(internal)?
        .filter(|b| b.status == "active")
        .ok_or_else(|| AppError::NotFound("brand not found".into()))?;
    let today = trip_time::local_today();
    let last_day = NaiveDate::parse_from_str(&today, "%Y-%m-%d")
        .map_err(|e| AppError::Internal(e.to_string()))?
        + chrono::Duration::days(UPCOMING_DAYS - 1);

    let brand_id = brand.id.to_string();
    let (route_store, brand_store, review_store) = (
        store.route_store(),
        store.brand_store(),
        store.review_store(),
    );
    let (routes, locations, review_count) = tokio::try_join!(
        route_store.list_routes_by_brand(&brand_id),
        brand_store.list_locations(brand.id, LOCATION_CAP),
        review_store.count_reviews(Some(&brand_id), None, None, Some("approved"), None),
    )
    .map_err(internal)?;
    let mut routes: Vec<_> = routes
        .into_iter()
        .filter(|r| r.status == "active")
        .collect();
    routes.sort_by(|a, b| a.name.cmp(&b.name));

    let mut schedules = store
        .schedule_store()
        .list_schedules_by_routes(routes.iter().map(|r| r.id).collect())
        .await
        .map_err(internal)?;
    // A schedule whose window has closed never departs again.
    schedules.retain(|s| s.effective_to.as_ref().is_none_or(|to| *to >= today));
    schedules.sort_by(|a, b| {
        a.departure_time
            .cmp(&b.departure_time)
            .then_with(|| a.id.cmp(&b.id))
    });

    let vehicle_types: HashMap<Uuid, String> = store
        .vehicle_type_store()
        .find_vehicle_types_by_ids(schedules.iter().filter_map(|s| s.vehicle_type_id).collect())
        .await
        .map_err(internal)?
        .into_iter()
        .map(|v| (v.id, v.label))
        .collect();
    let vehicle_type = |s: &schedule::Model| {
        s.vehicle_type_id
            .and_then(|id| vehicle_types.get(&id))
            .cloned()
    };

    let trips = store
        .trip_store()
        .list_scheduled_trips_between(
            schedules.iter().map(|s| s.id).collect(),
            &today,
            &last_day.format("%Y-%m-%d").to_string(),
        )
        .await
        .map_err(internal)?;
    let by_id: HashMap<Uuid, &schedule::Model> = schedules.iter().map(|s| (s.id, s)).collect();
    let mut trips: Vec<ProfileTrip> = trips
        .into_iter()
        .filter_map(|trip| {
            let schedule = *by_id.get(&trip.schedule_id)?;
            on_sale(&trip, schedule).then(|| ProfileTrip {
                trip_id: trip.id,
                route_id: schedule.route_id,
                date: trip.departure_date,
                departure_time: schedule.departure_time.clone(),
                available_seats: trip.available_seats,
                total_seats: trip.total_seats,
                vehicle_type: vehicle_type(schedule),
                price_adult: schedule.base_price_adult,
            })
        })
        .collect();
    trips.sort_by(|a, b| {
        (&a.date, &a.departure_time)
            .cmp(&(&b.date, &b.departure_time))
            .then_with(|| a.trip_id.cmp(&b.trip_id))
    });
    trips.truncate(UPCOMING_TRIP_CAP);

    let routes = routes
        .iter()
        .map(|r| {
            let own: Vec<&schedule::Model> =
                schedules.iter().filter(|s| s.route_id == r.id).collect();
            let (from_name, to_name) = endpoint_names(r);
            let (from, to) = (
                city_point(&r.start_location_id),
                city_point(&r.end_location_id),
            );
            ProfileRoute {
                id: r.id,
                name: r.name.clone(),
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
                price_from: own.iter().map(|s| s.base_price_adult).min(),
                schedules: own
                    .into_iter()
                    .map(|s| ProfileSchedule {
                        id: s.id,
                        departure_time: s.departure_time.clone(),
                        days_of_week: s.days_of_week.clone().filter(|d| {
                            d.len() == 7 && d.bytes().all(|b| matches!(b, b'0' | b'1'))
                        }),
                        vehicle_type: vehicle_type(s),
                        price_adult: s.base_price_adult,
                    })
                    .collect(),
            }
        })
        .collect();

    Ok(BrandProfile {
        brand: ProfileBrand {
            id: brand.id,
            slug: brand.slug,
            name: brand.name,
            logo_url: brand.logo_url,
            description: brand.description,
            contact_phone: brand.contact_phone,
            contact_email: brand.contact_email,
            rating: brand.rating,
            review_count,
        },
        locations: locations_by_city(locations),
        routes,
        trips,
    })
}

/// The locations by city then name, in Vietnamese alphabetical order (the
/// database sorts by bytes, which puts "Hà Nội" after "Huế").
fn locations_by_city(mut addresses: Vec<address::Model>) -> Vec<ProfileLocation> {
    addresses.sort_by(|a, b| {
        vi_cmp(
            a.province.as_deref().unwrap_or(""),
            b.province.as_deref().unwrap_or(""),
        )
        .then_with(|| vi_cmp(&a.name, &b.name))
    });
    addresses
        .into_iter()
        .map(|a| ProfileLocation {
            id: a.id,
            name: a.name,
            address: a.address,
            city: a.province,
            lat: Some(a.lat),
            lon: Some(a.lon),
        })
        .collect()
}

/// Vietnamese alphabetical order: the letters a ă â b c d đ e ê g h i k l
/// m n o ô ơ p q r s t u ư v x y, then the tone (none, grave, hook above,
/// tilde, acute, dot below), then lower case before upper case. Spaces and
/// digits sort before letters.
fn vi_cmp(a: &str, b: &str) -> Ordering {
    vi_key(a).cmp(&vi_key(b))
}

/// `(letters, tones, capitals)`, compared in that order.
fn vi_key(text: &str) -> (Vec<u32>, Vec<u8>, Vec<bool>) {
    let (mut letters, mut tones, mut capitals) = (Vec::new(), Vec::new(), Vec::new());
    for c in text.nfd() {
        if is_combining_mark(c) {
            // A mark belongs to the letter before it.
            match c {
                '\u{0306}' => bump(letters.last_mut(), 1),
                '\u{0302}' => bump(letters.last_mut(), 2),
                '\u{031B}' => bump(letters.last_mut(), 3),
                '\u{0300}' => set(tones.last_mut(), 1),
                '\u{0309}' => set(tones.last_mut(), 2),
                '\u{0303}' => set(tones.last_mut(), 3),
                '\u{0301}' => set(tones.last_mut(), 4),
                '\u{0323}' => set(tones.last_mut(), 5),
                _ => {}
            }
            continue;
        }
        let lower = c.to_lowercase().next().unwrap_or(c);
        // `đ` sorts right after `d`; letters leave room for a shape mark.
        let letter = match lower {
            'đ' => u32::from('d') * 4 + 1,
            l if l.is_alphabetic() => u32::from(l) * 4,
            other => u32::from(other),
        };
        letters.push(letter);
        tones.push(0);
        capitals.push(c != lower);
    }
    (letters, tones, capitals)
}

fn bump(letter: Option<&mut u32>, shape: u32) {
    if let Some(l) = letter {
        *l += shape;
    }
}

fn set(tone: Option<&mut u8>, value: u8) {
    if let Some(t) = tone {
        *t = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(mut names: Vec<&'static str>) -> Vec<&'static str> {
        names.sort_by(|a, b| vi_cmp(a, b));
        names
    }

    #[test]
    fn vietnamese_order_puts_ha_noi_before_hue() {
        assert_eq!(
            sorted(vec!["Huế", "Hà Nội", "Đà Nẵng", "Cần Thơ"]),
            ["Cần Thơ", "Đà Nẵng", "Hà Nội", "Huế"]
        );
    }

    #[test]
    fn vietnamese_order_ranks_shapes_then_tones() {
        assert_eq!(
            sorted(vec!["ê", "e", "ă", "â", "a", "d", "đ", "ơ", "o", "ô"]),
            ["a", "ă", "â", "d", "đ", "e", "ê", "o", "ô", "ơ"]
        );
        assert_eq!(
            sorted(vec!["ả", "ạ", "á", "ã", "à", "a"]),
            ["a", "à", "ả", "ã", "á", "ạ"]
        );
    }

    #[test]
    fn vietnamese_order_puts_lower_case_first_and_a_prefix_first() {
        assert_eq!(sorted(vec!["Hà", "hà"]), ["hà", "Hà"]);
        assert_eq!(sorted(vec!["Hà Nội", "Hà"]), ["Hà", "Hà Nội"]);
    }
}
