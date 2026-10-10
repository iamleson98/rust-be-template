//! Bookings as customers and staff see them.
//!
//! One serializer for every listing and detail view: it loads what a page
//! of bookings refers to (trips, schedules, routes, brands, layouts, seats,
//! reviews) in a fixed number of queries, whatever the page size.

use std::collections::{HashMap, HashSet};

use chrono::Utc;
use uuid::Uuid;

use crate::dto::booking::{BookingOut, BookingReview, BookingSeatOut, BookingStop, BookingTrip};
use crate::entity::{booking, bus_layout, schedule, trip_session};
use crate::error::{AppError, AppResult};
use crate::service::review_service::review_to_dto;
use crate::service::trip_time;
use crate::store::CompositeStore;

fn internal(e: crate::store::StoreError) -> AppError {
    AppError::Internal(e.to_string())
}

/// The departure instant of a trip on `schedule`, RFC 3339 (UTC).
pub fn departure_at(trip: &trip_session::Model, schedule: &schedule::Model) -> Option<String> {
    trip_time::departure_instant(
        &trip.departure_date,
        &schedule.departure_time,
        trip.actual_departure_at.as_deref(),
    )
    .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// When `b`'s trip leaves, if its trip and schedule still exist.
pub async fn departure_of(
    store: &CompositeStore,
    b: &booking::Model,
) -> AppResult<Option<chrono::DateTime<Utc>>> {
    let Some(trip) = store
        .trip_store()
        .find_trip_by_id(b.trip_session_id)
        .await?
    else {
        return Ok(None);
    };
    let schedule = store
        .schedule_store()
        .find_schedule_by_id(trip.schedule_id)
        .await?;
    Ok(schedule.and_then(|s| {
        trip_time::departure_instant(
            &trip.departure_date,
            &s.departure_time,
            trip.actual_departure_at.as_deref(),
        )
    }))
}

/// `bookings` as [`BookingOut`], in the same order.
pub async fn booking_views(
    store: &CompositeStore,
    bookings: Vec<booking::Model>,
) -> AppResult<Vec<BookingOut>> {
    if bookings.is_empty() {
        return Ok(Vec::new());
    }
    let unique = |ids: Vec<Uuid>| -> Vec<Uuid> {
        ids.into_iter()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect()
    };

    let trips: HashMap<Uuid, trip_session::Model> = store
        .trip_store()
        .list_trips_by_ids(unique(bookings.iter().map(|b| b.trip_session_id).collect()))
        .await
        .map_err(internal)?
        .into_iter()
        .map(|t| (t.id, t))
        .collect();
    let schedules: HashMap<Uuid, schedule::Model> = store
        .schedule_store()
        .list_schedules_by_ids(unique(trips.values().map(|t| t.schedule_id).collect()))
        .await
        .map_err(internal)?
        .into_iter()
        .map(|s| (s.id, s))
        .collect();
    let routes: HashMap<Uuid, _> = store
        .route_store()
        .list_routes_by_ids(unique(schedules.values().map(|s| s.route_id).collect()))
        .await
        .map_err(internal)?
        .into_iter()
        .map(|r| (r.id, r))
        .collect();
    let brands: HashMap<Uuid, _> = store
        .brand_store()
        .list_brands_by_ids(unique(routes.values().filter_map(|r| r.brand_id).collect()))
        .await
        .map_err(internal)?
        .into_iter()
        .map(|b| (b.id, b))
        .collect();
    let mut layouts: HashMap<Uuid, bus_layout::Model> = HashMap::new();
    for id in unique(schedules.values().filter_map(|s| s.bus_layout_id).collect()) {
        if let Some(l) = store
            .schedule_store()
            .find_bus_layout_by_id(id)
            .await
            .map_err(internal)?
        {
            layouts.insert(id, l);
        }
    }

    let booking_ids: Vec<Uuid> = bookings.iter().map(|b| b.id).collect();
    let tickets = store
        .booking_store()
        .list_booking_seats_by_booking_ids(booking_ids.iter().map(Uuid::to_string).collect())
        .await
        .map_err(internal)?;
    let seats: HashMap<Uuid, _> = store
        .trip_store()
        .list_seats_by_ids(
            unique(tickets.iter().map(|t| t.seat_id).collect())
                .iter()
                .map(Uuid::to_string)
                .collect(),
        )
        .await
        .map_err(internal)?
        .into_iter()
        .map(|s| (s.id, s))
        .collect();
    let reviews: HashMap<Uuid, _> = store
        .review_store()
        .list_reviews_by_bookings(booking_ids)
        .await
        .map_err(internal)?
        .into_iter()
        .filter_map(|r| Some((r.booking_id?, r)))
        .collect();

    // Bookings sold before stops were copied onto them still name their
    // route pickup points by id.
    let mut legacy_points = HashMap::new();
    for id in unique(
        bookings
            .iter()
            .filter(|b| b.pickup_name.is_none() || b.dropoff_name.is_none())
            .flat_map(|b| [b.boarding_point_id, b.dropping_point_id])
            .flatten()
            .collect(),
    ) {
        if let Some(p) = store
            .route_store()
            .find_pickup_point_by_id(id)
            .await
            .map_err(internal)?
        {
            legacy_points.insert(id, p);
        }
    }
    let legacy_stop = |id: Option<Uuid>| {
        let p = legacy_points.get(&id?)?;
        Some(BookingStop {
            name: p.name.clone()?,
            address: p.address.clone(),
            lat: p.lat,
            lon: p.lon,
        })
    };
    let now = Utc::now();

    Ok(bookings
        .into_iter()
        .map(|b| {
            let trip = trips.get(&b.trip_session_id);
            let schedule = trip.and_then(|t| schedules.get(&t.schedule_id));
            let route = schedule.and_then(|s| routes.get(&s.route_id));
            let brand = route
                .and_then(|r| r.brand_id)
                .and_then(|id| brands.get(&id));
            let from = route.and_then(|r| crate::cities::find_by_slug(&r.start_location_id));
            let to = route.and_then(|r| crate::cities::find_by_slug(&r.end_location_id));
            let departs = trip.zip(schedule).and_then(|(t, s)| departure_at(t, s));
            let departed = trip.zip(schedule).is_some_and(|(t, s)| {
                trip_time::departure_instant(
                    &t.departure_date,
                    &s.departure_time,
                    t.actual_departure_at.as_deref(),
                )
                .is_some_and(|at| at <= now)
            });

            let city = |c: Option<&crate::cities::City>| {
                c.map(|c| BookingStop {
                    name: c.name.to_string(),
                    address: None,
                    lat: Some(c.lat),
                    lon: Some(c.lon),
                })
            };
            let pickup = stop_of(
                &b.pickup_name,
                &b.pickup_address,
                b.pickup_lat,
                b.pickup_lon,
            )
            .or_else(|| legacy_stop(b.boarding_point_id))
            .or_else(|| city(from));
            let dropoff = stop_of(
                &b.dropoff_name,
                &b.dropoff_address,
                b.dropoff_lat,
                b.dropoff_lon,
            )
            .or_else(|| legacy_stop(b.dropping_point_id))
            .or_else(|| city(to));

            let mut seats_out: Vec<BookingSeatOut> = tickets
                .iter()
                .filter(|t| t.booking_id == b.id)
                .map(|t| {
                    let seat = seats.get(&t.seat_id);
                    BookingSeatOut {
                        seat_id: Some(t.seat_id),
                        seat_code: seat.map(|s| s.seat_label.clone()),
                        seat_class: seat.and_then(|s| s.seat_class.clone()),
                        passenger_name: t.passenger_name.clone(),
                        passenger_type: t.passenger_type.clone(),
                        passenger_age: t.passenger_age.map(i64::from),
                        price: Some(t.price),
                    }
                })
                .collect();
            seats_out.sort_by(|a, b| a.seat_code.cmp(&b.seat_code));

            let review = reviews.get(&b.id).map(|r| {
                let r = review_to_dto(r);
                BookingReview {
                    id: r.id,
                    rating: r.rating,
                    title: r.title,
                    content: r.content,
                    tags: r.tags,
                    photos: r.photos,
                    created_at: r.created_at,
                }
            });

            BookingOut {
                can_cancel: matches!(b.status.as_str(), "pending" | "confirmed") && !departed,
                ticket_qr: None,
                trip: trip
                    .zip(schedule)
                    .zip(route)
                    .map(|((t, s), r)| BookingTrip {
                        id: t.id,
                        departure_date: t.departure_date.clone(),
                        departure_time: Some(s.departure_time.clone()),
                        departure_at: departs.clone(),
                        status: t.status.clone(),
                        route_id: r.id,
                        route_name: r.name.clone(),
                        from_name: from.map(|c| c.name.to_string()),
                        to_name: to.map(|c| c.name.to_string()),
                        brand_id: r.brand_id,
                        brand_name: brand.map(|b| b.name.clone()),
                        brand_accent: brand.and_then(|b| b.accent_color.clone()),
                        brand_logo: brand.and_then(|b| b.logo_url.clone()),
                        bus_layout_name: s
                            .bus_layout_id
                            .and_then(|id| layouts.get(&id))
                            .and_then(|l| l.name.clone()),
                    }),
                id: b.id,
                code: b.code,
                status: b.status,
                payment_method: b.payment_method,
                adult_count: b.adult_count,
                child_count: b.child_count,
                subtotal: b.subtotal,
                discount: b.discount,
                fees: b.fees,
                total: b.total,
                currency: b.currency,
                contact_name: b.contact_name,
                contact_phone: b.contact_phone,
                contact_email: b.contact_email,
                pickup,
                dropoff,
                seats: seats_out,
                review,
                expires_at: b.expires_at,
                created_at: b.created_at,
                updated_at: b.updated_at,
            }
        })
        .collect())
}

/// One booking as [`BookingOut`], with its boarding QR while it is open.
pub async fn booking_view(
    store: &CompositeStore,
    booking: booking::Model,
) -> AppResult<BookingOut> {
    let mut view = booking_views(store, vec![booking])
        .await?
        .pop()
        .ok_or_else(|| AppError::Internal("booking view missing".into()))?;
    if matches!(view.status.as_str(), "pending" | "confirmed") {
        view.ticket_qr = ticket_qr(&view.code);
    }
    Ok(view)
}

/// The boarding QR of a ticket: its code, as an SVG data URI.
fn ticket_qr(code: &str) -> Option<String> {
    use base64::Engine as _;
    let svg = qrcode::QrCode::new(code.as_bytes())
        .ok()?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .build();
    Some(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    ))
}

fn stop_of(
    name: &Option<String>,
    address: &Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Option<BookingStop> {
    Some(BookingStop {
        name: name.clone()?,
        address: address.clone(),
        lat,
        lon,
    })
}
