//! Where passengers get on and off.
//!
//! A route may list its own pickup points; when it has none, the stops of
//! the schedule's timetable are the places to board and alight. A booking
//! copies the chosen stops onto itself, so a ticket keeps showing them even
//! if the timetable changes later.

use std::collections::HashMap;

use uuid::Uuid;

use crate::dto::booking::BookingStop;
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

/// One place on a trip's way.
#[derive(Debug, Clone, PartialEq)]
pub struct Stop {
    pub id: Uuid,
    pub order: i64,
    pub name: String,
    pub address: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// `pickup` | `middle` | `drop` (or a route point's own kind).
    pub kind: Option<String>,
    /// A route pickup point (bookings reference those by id); otherwise a
    /// timetable stop, kept on the booking by name only.
    pub pickup_point: bool,
}

impl Stop {
    pub fn snapshot(&self) -> BookingStop {
        BookingStop {
            name: self.name.clone(),
            address: self.address.clone(),
            lat: self.lat,
            lon: self.lon,
        }
    }
}

/// The stops of a trip on `route_id` run by `schedule_id`, in order.
pub async fn trip_stops(
    store: &CompositeStore,
    route_id: Uuid,
    schedule_id: Uuid,
) -> AppResult<Vec<Stop>> {
    let internal = |e: crate::store::StoreError| AppError::Internal(e.to_string());
    let mut points = store
        .route_store()
        .list_pickup_points_by_route(&route_id.to_string())
        .await
        .map_err(internal)?;
    if !points.is_empty() {
        points.sort_by_key(|p| p.stop_order);
        return Ok(points
            .into_iter()
            .map(|p| Stop {
                id: p.id,
                order: p.stop_order,
                name: p.name.unwrap_or_default(),
                address: p.address,
                lat: p.lat,
                lon: p.lon,
                kind: p.kind,
                pickup_point: true,
            })
            .collect());
    }

    let timetable = store
        .address_store()
        .list_points_by_schedule(schedule_id)
        .await
        .map_err(internal)?;
    let addresses: HashMap<Uuid, _> = store
        .address_store()
        .list_addresses_by_ids(timetable.iter().map(|p| p.address_id).collect())
        .await
        .map_err(internal)?
        .into_iter()
        .map(|a| (a.id, a))
        .collect();
    Ok(timetable
        .into_iter()
        .filter_map(|p| {
            let a = addresses.get(&p.address_id)?;
            Some(Stop {
                id: p.id,
                order: p.stop_order,
                name: a.name.clone(),
                address: a.address.clone(),
                lat: Some(a.lat),
                lon: Some(a.lon),
                kind: Some(p.kind),
                pickup_point: false,
            })
        })
        .collect())
}

/// The boarding and alighting stops a booking asks for, checked against
/// the trip's stops: both are required when the trip has any, must be
/// among them, and boarding must come first. `None` when the trip lists no
/// stops (passengers board at the departure city).
pub fn choose(
    stops: &[Stop],
    boarding: Option<Uuid>,
    dropping: Option<Uuid>,
) -> AppResult<Option<(Stop, Stop)>> {
    if stops.is_empty() {
        return match (boarding, dropping) {
            (None, None) => Ok(None),
            _ => Err(invalid()),
        };
    }
    let find = |id: Option<Uuid>| id.and_then(|id| stops.iter().find(|s| s.id == id).cloned());
    match (find(boarding), find(dropping)) {
        (Some(on), Some(off)) if on.order < off.order => Ok(Some((on, off))),
        _ => Err(invalid()),
    }
}

fn invalid() -> AppError {
    AppError::BadRequest("choose a boarding stop and a later drop-off stop of this trip".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stop(order: i64) -> Stop {
        Stop {
            id: Uuid::new_v4(),
            order,
            name: format!("Stop {order}"),
            address: None,
            lat: None,
            lon: None,
            kind: None,
            pickup_point: false,
        }
    }

    #[test]
    fn boarding_must_come_before_dropping() {
        let stops = [stop(1), stop(2), stop(3)];
        let (on, off) = choose(&stops, Some(stops[0].id), Some(stops[2].id))
            .unwrap()
            .unwrap();
        assert_eq!((on.order, off.order), (1, 3));
        assert!(choose(&stops, Some(stops[2].id), Some(stops[0].id)).is_err());
        assert!(choose(&stops, Some(stops[1].id), Some(stops[1].id)).is_err());
    }

    #[test]
    fn stops_are_required_exactly_when_the_trip_has_some() {
        let stops = [stop(1), stop(2)];
        assert!(choose(&stops, None, None).is_err());
        assert!(choose(&stops, Some(Uuid::new_v4()), Some(stops[1].id)).is_err());
        assert!(choose(&[], None, None).unwrap().is_none());
        assert!(choose(&[], Some(stops[0].id), None).is_err());
    }
}
