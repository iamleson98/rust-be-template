//! Booking service — business logic for booking CRUD, hold, confirm, cancel.
//!
//! Ported from `booking-rs/logic/bookings.rs`, adapted to the template's
//! store + `AppError` architecture.
//!
//! ## Design
//! - Uses `CompositeStore` for all DB access (BookingStore, TripStore,
//!   ScheduleStore, RouteStore, BrandStore, PlaceStore).
//! - Returns `serde_json::Value` DTOs (no HTTP types).
//! - Pure helpers (normalize_phone, gen_booking_code, etc.) are ported as-is.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use rand::Rng;
use sea_orm::Set;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::entity::{
    booking, booking_seat, campaign, seat, seat_inventory, trip_session,
};
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

// ────────────────────────────────────────────────────────────────
//  Request DTOs
// ────────────────────────────────────────────────────────────────

/// One passenger on a booking.
#[derive(Debug, Deserialize, Clone)]
pub struct PassengerReq {
    pub name: String,
    #[serde(rename = "type")]
    pub passenger_type: String,
    #[serde(default)]
    pub age: i64,
}

/// Request body for `POST /api/bookings` and `POST /api/bookings/hold`.
#[derive(Debug, Deserialize, Clone)]
pub struct HoldReq {
    pub trip_id: String,
    pub seat_ids: Vec<String>,
    pub passengers: Vec<PassengerReq>,
    pub boarding_point_id: String,
    pub dropping_point_id: String,
    pub contact_name: String,
    pub contact_phone: String,
    #[serde(default)]
    pub contact_email: Option<String>,
    #[serde(default)]
    pub campaign_code: Option<String>,
}

/// Request body for `POST /api/bookings/:id/confirm`.
#[derive(Debug, Deserialize, Clone)]
pub struct ConfirmReq {
    #[serde(default = "default_payment")]
    pub payment_method: String,
}

fn default_payment() -> String {
    "momo".into()
}

/// Request body for `POST /api/bookings/:id/cancel`.
#[derive(Debug, Deserialize, Clone)]
pub struct CancelReq {
    #[serde(default)]
    pub reason: Option<String>,
}

// ────────────────────────────────────────────────────────────────
//  Service
// ────────────────────────────────────────────────────────────────

pub struct BookingService {
    store: Arc<CompositeStore>,
}

impl BookingService {
    pub fn new(store: Arc<CompositeStore>) -> Self {
        Self { store }
    }

    // ── Reads ────────────────────────────────────────────────────

    /// List the authenticated user's bookings, filtered by status bucket.
    pub async fn list(
        &self,
        user_id: &str,
        status: &str,
        limit: u64,
        offset: u64,
    ) -> AppResult<Value> {
        let limit = limit.min(200);
        let status_param = status.trim().to_lowercase();
        let valid = [
            "confirmed",
            "completed",
            "cancelled",
            "upcoming",
            "past",
            "all",
        ];
        if !valid.contains(&status_param.as_str()) {
            return Err(AppError::BadRequest("invalid status value".into()));
        }

        let today_prefix = Utc::now().format("%Y-%m-%d").to_string();

        // Resolve trip session IDs by departure-date bucket
        let trip_ids_gte: Vec<String> = if status_param == "confirmed" || status_param == "upcoming"
        {
            self.store.trip_store()
                .list_trips_departing_after(&today_prefix)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .iter()
                .map(|t| t.id.to_string())
                .collect()
        } else {
            Vec::new()
        };

        let trip_ids_lt: Vec<String> = if status_param == "completed" || status_param == "past" {
            self.store.trip_store()
                .list_trips_departing_before(&today_prefix)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .iter()
                .map(|t| t.id.to_string())
                .collect()
        } else {
            Vec::new()
        };

        // Build the trip-session-id filter for the booking store
        let trip_filter: Option<Vec<String>> = match status_param.as_str() {
            "confirmed" | "upcoming" => {
                if trip_ids_gte.is_empty() {
                    Some(vec!["__none__".to_string()])
                } else {
                    Some(trip_ids_gte)
                }
            }
            "completed" | "past" => {
                if trip_ids_lt.is_empty() {
                    Some(vec!["__none__".to_string()])
                } else {
                    Some(trip_ids_lt)
                }
            }
            _ => None,
        };

        let bookings = self.store.booking_store()
            .list_bookings_by_user(
                user_id,
                &status_param,
                trip_filter.unwrap_or_default(),
                limit,
                offset,
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Batch serialize
        let items = self
            .serialize_bookings_batched(&bookings, true)
            .await?;

        Ok(json!({ "items": items, "total": items.len() }))
    }

    /// Guest lookup by booking code and/or phone.
    pub async fn lookup(&self, phone: Option<&str>, code: Option<&str>) -> AppResult<Value> {
        let code = code.map(|s| s.trim()).filter(|s| !s.is_empty());
        let phone = phone.map(|s| s.trim()).filter(|s| !s.is_empty());

        if code.is_none() && phone.is_none() {
            return Ok(json!({ "items": [] }));
        }

        let bookings = self.store.booking_store()
            .lookup_bookings(code, phone, 20)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items = self
            .serialize_bookings_batched(&bookings, false)
            .await?;

        Ok(json!({ "items": items }))
    }

    /// Full booking detail with seats, pickup points, trip + brand info.
    ///
    /// ## Performance
    ///
    /// The dependency chain `booking → trip → schedule → route` is
    /// inherently sequential (each fetch's id comes from the previous
    /// row). But once we have the `route` + `schedule`, the brand,
    /// start/end places, bus layout, and pickup points are all
    /// independent — we fetch them concurrently with `tokio::try_join!`
    /// to cut latency from ~7 sequential round-trips to ~4.
    pub async fn detail(&self, user_id: Option<&str>, id: Uuid) -> AppResult<Value> {
        let b = self.store.booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // Ownership check
        if let Some(uid) = user_id {
            if b.user_id.as_deref() != Some(uid) {
                return Err(AppError::Forbidden("not your booking".into()));
            }
        }

        // Fetch booking seats + trip concurrently (independent of each other).
        let booking_id_str = b.id.to_string();
        let trip_id = Uuid::parse_str(&b.trip_session_id)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let store = self.store.clone();
        let (seats, trip) = tokio::try_join!(
            async {
                store.booking_store()
                    .list_booking_seats(&booking_id_str)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
            },
            async {
                store.trip_store()
                    .find_trip_by_id(trip_id)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .ok_or_else(|| AppError::NotFound("trip not found".into()))
            }
        )?;

        // Fetch seat definitions (depends on seats).
        let seat_ids: Vec<String> = seats.iter().map(|s| s.seat_id.clone()).collect();
        let seat_defs = self.fetch_seat_defs(&seat_ids).await?;

        // Fetch schedule (depends on trip).
        let schedule_id = Uuid::parse_str(&trip.schedule_id)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let schedule = self.store.schedule_store()
            .find_schedule_by_id(schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        // Fetch route (depends on schedule).
        let route_id = Uuid::parse_str(&schedule.route_id)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let route_model = self.store.route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        // ── Concurrent fetch of independent relations ────────────
        // brand, start_place, end_place, bus_layout, pickup_points all
        // depend only on `route_model` / `schedule` (already loaded).
        // Running them in parallel cuts ~5 sequential round-trips to 1.
        let store = self.store.clone();
        let brand_id = route_model.brand_id.clone();
        let start_location_id = route_model.start_location_id.clone();
        let end_location_id = route_model.end_location_id.clone();
        let bus_layout_id = schedule.bus_layout_id.clone();
        let route_id_str = route_model.id.to_string();

        let (brand_model, start_place, end_place, bus_layout, pickup_points) = tokio::try_join!(
            async {
                // Brand
                match brand_id.as_ref().and_then(|bid| Uuid::parse_str(bid).ok()) {
                    Some(uid) => store.brand_store().get_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // Start place
                match start_location_id.as_ref().and_then(|id| Uuid::parse_str(id).ok()) {
                    Some(uid) => store.place_store().find_place_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // End place
                match end_location_id.as_ref().and_then(|id| Uuid::parse_str(id).ok()) {
                    Some(uid) => store.place_store().find_place_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // Bus layout
                match bus_layout_id.as_ref().and_then(|blid| Uuid::parse_str(blid).ok()) {
                    Some(uid) => store.schedule_store().find_bus_layout_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // Pickup points
                store.route_store().list_pickup_points_by_route(&route_id_str)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
            }
        )?;

        // Build response
        let seats_json: Vec<Value> = seats
            .iter()
            .map(|bs| {
                let seat = seat_defs.get(&bs.seat_id);
                json!({
                    "seatCode": seat.map(|s| s.seat_label.clone()).unwrap_or_default(),
                    "seatClass": seat.and_then(|s| s.seat_class.clone()).unwrap_or_default(),
                    "passengerName": bs.passenger_name,
                    "passengerType": bs.passenger_type,
                    "passengerAge": bs.passenger_age,
                    "price": bs.price,
                })
            })
            .collect();

        let pickup_items: Vec<Value> = pickup_points
            .iter()
            .map(|p| {
                json!({
                    "id": p.id,
                    "name": p.name,
                    "stopOrder": p.stop_order,
                    "lat": p.lat,
                    "lon": p.lon,
                    "pickupType": p.kind,
                    "address": p.address,
                })
            })
            .collect();

        Ok(json!({
            "id": b.id,
            "code": b.code,
            "status": b.status,
            "adultCount": b.adult_count,
            "childCount": b.child_count,
            "subtotal": b.subtotal,
            "discount": b.discount,
            "fees": b.fees,
            "total": b.total,
            "currency": b.currency,
            "expiresAt": b.expires_at,
            "createdAt": b.created_at,
            "contactName": b.contact_name,
            "contactPhone": b.contact_phone,
            "contactEmail": b.contact_email,
            "seats": seats_json,
            "trip": {
                "id": trip.id,
                "departureAt": trip.actual_departure_at,
                "departureDate": trip.departure_date,
                "status": trip.status,
                "route": {
                    "name": route_model.name,
                    "from": start_place.map(|p| p.name.clone()),
                    "to": end_place.map(|p| p.name.clone()),
                    "distanceKm": route_model.distance_km,
                    "durationMin": route_model.duration_min,
                    "brand": {
                        "name": brand_model.as_ref().map(|b| b.name.clone()),
                        "accentColor": brand_model.as_ref().and_then(|b| b.accent_color.clone()),
                        "logoUrl": brand_model.as_ref().and_then(|b| b.logo_url.clone()),
                    },
                },
                "busLayout": {
                    "name": bus_layout.as_ref().map(|l| l.name.clone()),
                    "vehicleType": bus_layout.as_ref().map(|l| l.vehicle_type.clone()),
                },
                "pickupPoints": pickup_items,
            },
        }))
    }

    // ── Writes ───────────────────────────────────────────────────

    /// Create a booking (alias of hold).
    pub async fn create(&self, req: &HoldReq) -> AppResult<Value> {
        self.hold(req).await
    }

    /// Lock seats + create a pending booking (10-minute hold).
    pub async fn hold(&self, req: &HoldReq) -> AppResult<Value> {
        // Validate inputs
        if req.trip_id.is_empty()
            || req.seat_ids.is_empty()
            || req.boarding_point_id.is_empty()
            || req.dropping_point_id.is_empty()
            || req.contact_name.trim().is_empty()
            || req.contact_phone.trim().is_empty()
        {
            return Err(AppError::BadRequest("missing required fields".into()));
        }
        if req.passengers.len() != req.seat_ids.len() {
            return Err(AppError::BadRequest(
                "passenger count must match seat count".into(),
            ));
        }

        // Fetch trip
        let trip_id = Uuid::parse_str(&req.trip_id)
            .map_err(|e| AppError::BadRequest(format!("invalid trip_id: {e}")))?;
        let trip = self.store.trip_store()
            .find_trip_by_id(trip_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("trip not found".into()))?;

        if trip.status == "cancelled" {
            return Err(AppError::BadRequest("trip is cancelled".into()));
        }

        // Fetch schedule + route + brand
        let schedule_id = Uuid::parse_str(&trip.schedule_id)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let schedule = self.store.schedule_store()
            .find_schedule_by_id(schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let route_id = Uuid::parse_str(&schedule.route_id)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let route_model = self.store.route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        let brand_model = if let Some(ref bid) = route_model.brand_id {
            if let Ok(uid) = Uuid::parse_str(bid) {
                self.store.brand_store()
                    .get_by_id(uid)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
            } else {
                None
            }
        } else {
            None
        };

        // Fetch seat inventories
        let seat_uuids: Vec<String> = req
            .seat_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok().map(|u| u.to_string()))
            .collect();
        let seat_invs = self.store.trip_store()
            .list_seat_inventories(&req.trip_id, seat_uuids.clone())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        if seat_invs.len() != req.seat_ids.len() {
            return Err(AppError::BadRequest(
                "some seats not found or changed".into(),
            ));
        }

        // Check availability
        let unavailable: Vec<&seat_inventory::Model> = seat_invs
            .iter()
            .filter(|s| s.status != "available")
            .collect();
        if !unavailable.is_empty() {
            return Err(AppError::Conflict("some seats are no longer available".into()));
        }

        // Pricing
        let adult_count = req
            .passengers
            .iter()
            .filter(|p| p.passenger_type == "adult")
            .count() as i32;
        let child_count = req
            .passengers
            .iter()
            .filter(|p| p.passenger_type == "child")
            .count() as i32;
        let seat_prices: Vec<i64> = seat_invs
            .iter()
            .map(|s| s.final_price as i64)
            .collect();
        let subtotal: i64 = seat_prices.iter().sum();

        // Campaign discount
        let mut discount: i64 = 0;
        let mut applied_campaign_id: Option<String> = None;
        if let Some(ref cc) = req.campaign_code {
            let code = cc.trim().to_uppercase();
            let now = now_iso();
            let campaign = self.store.trip_store()
                .find_active_campaign(&code, &now)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;

            if let Some(c) = campaign {
                match c.discount_type.as_str() {
                    "percent" => {
                        let raw = ((subtotal as f64) * c.discount_value as f64
                            / 100.0)
                            .round() as i64;
                        discount = raw;
                    }
                    "fixed_amount" => {
                        discount = c.discount_value;
                    }
                    "free_child" if child_count > 0 => {
                        let cheapest = *seat_prices.iter().min().unwrap_or(&0);
                        discount = cheapest;
                    }
                    _ => {}
                }
                applied_campaign_id = Some(c.id.to_string());
            } else {
                return Err(AppError::BadRequest(
                    "invalid or expired campaign code".into(),
                ));
            }
        }

        let fees: i64 = 0;
        let total = (subtotal - discount + fees).max(0);

        // 10-minute hold
        let expires_at = now_plus_iso(10 * 60);
        let brand_slug = brand_model
            .as_ref()
            .map(|b| b.slug.clone())
            .unwrap_or_default();
        let code = gen_booking_code(&brand_prefix(&brand_slug));

        // Create the booking
        let booking_id = Uuid::new_v4();
        let now = now_iso();
        let booking_model = booking::ActiveModel {
            id: Set(booking_id),
            code: Set(code.clone()),
            user_id: Set(None), // Will be set by the route handler from auth context
            trip_session_id: Set(req.trip_id.clone()),
            boarding_point_id: Set(Some(req.boarding_point_id.clone())),
            dropping_point_id: Set(Some(req.dropping_point_id.clone())),
            adult_count: Set(adult_count),
            child_count: Set(child_count),
            subtotal: Set(subtotal as i32),
            discount: Set(discount as i32),
            fees: Set(fees as i32),
            total: Set(total as i32),
            currency: Set("VND".to_string()),
            status: Set("pending".to_string()),
            payment_method: Set(None),
            contact_name: Set(Some(req.contact_name.clone())),
            contact_phone: Set(Some(req.contact_phone.clone())),
            contact_email: Set(req.contact_email.clone()),
            expires_at: Set(Some(expires_at.clone())),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            ..Default::default()
        };

        self.store.booking_store()
            .insert_booking(booking_model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Create booking seats
        for (i, inv) in seat_invs.iter().enumerate() {
            let passenger = &req.passengers[i];
            let bs_model = booking_seat::ActiveModel {
                id: Set(Uuid::new_v4()),
                booking_id: Set(booking_id.to_string()),
                seat_id: Set(inv.seat_id.clone()),
                passenger_name: Set(Some(passenger.name.clone())),
                passenger_type: Set(Some(passenger.passenger_type.clone())),
                passenger_age: Set(Some(passenger.age as i16)),
                price: Set(inv.final_price),
                ..Default::default()
            };
            self.store.booking_store()
                .insert_booking_seat(bs_model)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }

        // Lock the seats atomically.
        //
        // We use a conditional UPDATE (`try_hold_seat`) that only flips
        // the seat from 'available' → 'held' if it is STILL available.
        // This closes the TOCTOU race: two concurrent holds on the same
        // seat can no longer both succeed — the DB serializes the
        // UPDATEs, so exactly one request gets `rows_affected == 1`.
        //
        // If any seat fails to claim, we roll back the seats we already
        // claimed (release them back to 'available') and return a 409.
        let booking_id_str = booking_id.to_string();
        let mut claimed: Vec<String> = Vec::with_capacity(seat_invs.len());
        let mut conflict = false;
        for inv in &seat_invs {
            let ok = self.store.trip_store()
                .try_hold_seat(
                    &req.trip_id,
                    &inv.seat_id,
                    &booking_id_str,
                    &expires_at,
                )
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if ok {
                claimed.push(inv.seat_id.clone());
            } else {
                conflict = true;
                break;
            }
        }

        if conflict {
            // Roll back the seats we did claim so they're available again.
            // Uses a conditional UPDATE (only releases seats held by THIS
            // booking) so we never clobber a different booking's hold.
            for seat_id in &claimed {
                let _ = self.store.trip_store()
                    .release_held_seat(&req.trip_id, seat_id, &booking_id_str)
                    .await;
            }
            return Err(AppError::Conflict(
                "some seats are no longer available".into(),
            ));
        }

        // Decrement available seats on the trip session
        let current_available = trip.available_seats;
        let mut trip_active: trip_session::ActiveModel = trip.into();
        trip_active.available_seats = Set(current_available - req.seat_ids.len() as i64);
        self.store.trip_store()
            .update_trip_session(trip_active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Increment campaign usage
        if let Some(ref cid) = applied_campaign_id {
            let c_uuid = Uuid::parse_str(cid).map_err(|e| AppError::Internal(e.to_string()))?;
            if let Some(c) = self.store.trip_store()
                .find_campaign_by_id(c_uuid)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
            {
                let current_used = c.used_count;
                let mut active: campaign::ActiveModel = c.into();
                active.used_count = Set(current_used + 1);
                let _ = self.store.trip_store()
                    .update_campaign(active)
                    .await;
            }
        }

        // Build response
        let seats_json: Vec<Value> = seat_invs
            .iter()
            .enumerate()
            .map(|(i, inv)| {
                let passenger = &req.passengers[i];
                json!({
                    "seatId": inv.seat_id,
                    "passengerName": passenger.name,
                    "passengerType": passenger.passenger_type,
                    "price": inv.final_price,
                })
            })
            .collect();

        Ok(json!({
            "bookingId": booking_id,
            "code": code,
            "status": "pending",
            "subtotal": subtotal,
            "discount": discount,
            "fees": fees,
            "total": total,
            "expiresAt": expires_at,
            "seats": seats_json,
            "campaignId": applied_campaign_id,
        }))
    }

    /// Cancel a booking (with refund calculation).
    ///
    /// Refund policy:
    ///   - > 24h before departure → 90% refund
    ///   - > 4h before departure → 50% refund
    ///   - ≤ 4h before departure → 0% refund
    pub async fn cancel(
        &self,
        id: Uuid,
        reason: Option<&str>,
    ) -> AppResult<Value> {
        let b = self.store.booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if b.status == "cancelled" {
            return Err(AppError::BadRequest("booking already cancelled".into()));
        }

        // Fetch trip for refund calculation
        let trip_id = Uuid::parse_str(&b.trip_session_id)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let trip = self.store.trip_store()
            .find_trip_by_id(trip_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let hours_until = if let Some(ref dep) = trip.as_ref().and_then(|t| t.actual_departure_at.clone()) {
            chrono::DateTime::parse_from_rfc3339(dep)
                .map(|dt| (dt.with_timezone(&Utc) - Utc::now()).num_hours() as f64)
                .unwrap_or(24.0)
        } else {
            24.0 // default to full refund if no departure time
        };

        let refund_percent: i64 = if hours_until > 24.0 {
            90
        } else if hours_until > 4.0 {
            50
        } else {
            0
        };
        let refund_amount = b.total as i64 * refund_percent / 100;

        // Release held seats
        let seat_invs = self.store.trip_store()
            .list_seat_inventories_by_held_booking(&b.id.to_string())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let seat_count = seat_invs.len() as i64;
        for inv in &seat_invs {
            let mut active: seat_inventory::ActiveModel = inv.clone().into();
            active.status = Set("available".to_string());
            active.held_until = Set(None);
            active.held_by_booking_id = Set(None);
            self.store.trip_store()
                .update_seat_inventory(active)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }

        // Re-add available seats to trip session
        if let Some(t) = trip {
            let current_available = t.available_seats;
            let mut trip_active: trip_session::ActiveModel = t.into();
            trip_active.available_seats = Set(current_available + seat_count);
            self.store.trip_store()
                .update_trip_session(trip_active)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }

        // Mark booking cancelled
        let booking_code = b.code.clone();
        let mut booking_active: booking::ActiveModel = b.into();
        booking_active.status = Set("cancelled".to_string());
        booking_active.updated_at = Set(now_iso());
        self.store.booking_store()
            .update_booking(booking_active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Generate cancellation reference code
        let ts_b36 = to_base36(Utc::now().timestamp_millis());
        let ref_code = format!("HX-{}-{}", booking_code.to_uppercase(), ts_b36.to_uppercase());

        Ok(json!({
            "success": true,
            "refundPercent": refund_percent,
            "refundAmount": refund_amount,
            "cancelledAt": now_iso(),
            "refCode": ref_code,
            "reason": reason,
        }))
    }

    /// Confirm a booking (mark paid — locked → booked).
    pub async fn confirm(
        &self,
        id: Uuid,
        payment_method: &str,
    ) -> AppResult<Value> {
        let b = self.store.booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if b.status != "pending" {
            return Err(AppError::BadRequest("booking is not in pending status".into()));
        }

        // Check expiry
        if let Some(ref exp) = b.expires_at {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(exp) {
                if t.with_timezone(&Utc) < Utc::now() {
                    // Expired — release seats, mark cancelled
                    let seat_invs = self.store.trip_store()
                        .list_seat_inventories_by_held_booking(&b.id.to_string())
                        .await
                        .map_err(|e| AppError::Internal(e.to_string()))?;
                    for inv in &seat_invs {
                        let mut active: seat_inventory::ActiveModel = inv.clone().into();
                        active.status = Set("available".to_string());
                        active.held_until = Set(None);
                        active.held_by_booking_id = Set(None);
                        let _ = self.store.trip_store()
                            .update_seat_inventory(active)
                            .await;
                    }
                    let mut booking_active: booking::ActiveModel = b.into();
                    booking_active.status = Set("cancelled".to_string());
                    booking_active.updated_at = Set(now_iso());
                    let _ = self.store.booking_store()
                        .update_booking(booking_active)
                        .await;

                    return Err(AppError::Gone("booking hold has expired".into()));
                }
            }
        }

        // Convert locked → booked
        let seat_invs = self.store.trip_store()
            .list_seat_inventories_by_held_booking(&b.id.to_string())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        for inv in &seat_invs {
            let mut active: seat_inventory::ActiveModel = inv.clone().into();
            active.status = Set("booked".to_string());
            active.held_until = Set(None);
            self.store.trip_store()
                .update_seat_inventory(active)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }

        // Update booking status + payment method
        let mut booking_active: booking::ActiveModel = b.into();
        booking_active.status = Set("confirmed".to_string());
        booking_active.payment_method = Set(Some(payment_method.to_string()));
        booking_active.updated_at = Set(now_iso());
        self.store.booking_store()
            .update_booking(booking_active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        Ok(json!({
            "bookingId": id,
            "status": "confirmed",
            "paymentMethod": payment_method,
        }))
    }

    // ── Batched serializer ───────────────────────────────────────

    /// Batched bookings serializer — fetches related data in bulk to avoid N+1.
    async fn serialize_bookings_batched(
        &self,
        bookings: &[booking::Model],
        include_boarding_dropping_ids: bool,
    ) -> AppResult<Vec<Value>> {
        if bookings.is_empty() {
            return Ok(Vec::new());
        }

        // Collect trip session IDs
        let trip_session_ids: Vec<String> = bookings
            .iter()
            .map(|b| b.trip_session_id.clone())
            .collect();

        // Batch fetch trip sessions
        let trip_uuids: Vec<Uuid> = trip_session_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let trips: HashMap<String, trip_session::Model> = self.store.trip_store()
            .list_trips_by_ids(trip_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|t| (t.id.to_string(), t))
            .collect();

        // Batch fetch schedules
        let schedule_ids: Vec<String> = trips
            .values()
            .map(|t| t.schedule_id.clone())
            .collect();
        let schedule_uuids: Vec<Uuid> = schedule_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let schedules: HashMap<String, crate::entity::schedule::Model> = self.store.schedule_store()
            .list_schedules_by_ids(schedule_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|s| (s.id.to_string(), s))
            .collect();

        // Batch fetch routes
        let route_ids: Vec<String> = schedules
            .values()
            .map(|s| s.route_id.clone())
            .collect();
        let route_uuids: Vec<Uuid> = route_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let routes: HashMap<String, crate::entity::route::Model> = self.store.route_store()
            .list_routes_by_ids(route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|r| (r.id.to_string(), r))
            .collect();

        // Batch fetch brands
        let brand_ids: Vec<String> = routes
            .values()
            .filter_map(|r| r.brand_id.clone())
            .collect();
        let brand_uuids: Vec<Uuid> = brand_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let brands: HashMap<String, crate::entity::brand::Model> = self.store.brand_store()
            .list_brands_by_ids(brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id.to_string(), b))
            .collect();

        // Batch fetch booking seats
        let booking_ids: Vec<String> = bookings.iter().map(|b| b.id.to_string()).collect();
        let all_seats: Vec<booking_seat::Model> = self.store.booking_store()
            .list_booking_seats_by_booking_ids(booking_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut seats_by_booking: HashMap<String, Vec<&booking_seat::Model>> = HashMap::new();
        for bs in &all_seats {
            seats_by_booking
                .entry(bs.booking_id.clone())
                .or_default()
                .push(bs);
        }

        // Build per-booking JSON
        let mut items: Vec<Value> = Vec::with_capacity(bookings.len());
        for b in bookings {
            let trip = trips.get(&b.trip_session_id);
            let schedule = trip.and_then(|t| schedules.get(&t.schedule_id));
            let route = schedule.and_then(|s| routes.get(&s.route_id));
            let brand = route
                .and_then(|r| r.brand_id.as_deref())
                .and_then(|bid| brands.get(bid));

            let trip_json = if let (Some(t), Some(s), Some(r)) = (trip, schedule, route) {
                Some(json!({
                    "id": t.id,
                    "departureAt": t.actual_departure_at,
                    "departureDate": t.departure_date,
                    "status": t.status,
                    "routeName": r.name,
                    "brandName": brand.map(|b| b.name.clone()).unwrap_or_default(),
                    "brandAccent": brand.and_then(|b| b.accent_color.clone()).unwrap_or_else(|| "#0d9488".into()),
                    "brandLogo": brand.and_then(|b| b.logo_url.clone()),
                    "vehicleType": s.bus_layout_id.as_deref().unwrap_or(""),
                }))
            } else {
                None
            };

            let booking_seats: &[&booking_seat::Model] = seats_by_booking
                .get(&b.id.to_string())
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

            let seats_json: Vec<Value> = booking_seats
                .iter()
                .map(|bs| {
                    json!({
                        "seatId": bs.seat_id,
                        "passengerName": bs.passenger_name,
                        "passengerType": bs.passenger_type,
                        "price": bs.price,
                    })
                })
                .collect();

            let paid_at = if b.status == "confirmed" {
                Some(b.updated_at.clone())
            } else {
                None
            };

            let item = if include_boarding_dropping_ids {
                json!({
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
                    "boardingPointId": b.boarding_point_id,
                    "droppingPointId": b.dropping_point_id,
                    "paymentMethod": b.payment_method,
                    "createdAt": b.created_at,
                    "updatedAt": b.updated_at,
                    "paidAt": paid_at,
                    "expiresAt": b.expires_at,
                    "seats": seats_json,
                    "trip": trip_json,
                })
            } else {
                json!({
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
                    "createdAt": b.created_at,
                    "updatedAt": b.updated_at,
                    "paidAt": paid_at,
                    "expiresAt": b.expires_at,
                    "seats": seats_json,
                    "trip": trip_json,
                })
            };
            items.push(item);
        }

        Ok(items)
    }

    // ── Private helpers ─────────────────────────────────────────

    /// Fetch seat definitions by IDs.
    async fn fetch_seat_defs(
        &self,
        seat_ids: &[String],
    ) -> AppResult<HashMap<String, seat::Model>> {
        if seat_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = self.store.trip_store()
            .list_seats_by_ids(seat_ids.to_vec())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|s| (s.id.to_string(), s))
            .collect())
    }
}

// ────────────────────────────────────────────────────────────────
//  Pure helpers (no DB, no async)
// ────────────────────────────────────────────────────────────────

/// Vietnamese phone normalization.
pub fn normalize_phone(phone: &str) -> String {
    let p: String = phone.chars().filter(|c| !c.is_whitespace()).collect();
    if p.starts_with('0') {
        format!("+84{}", &p[1..])
    } else if p.starts_with("84") {
        format!("+{}", p)
    } else {
        p
    }
}

/// Generate a human-readable booking code.
pub fn gen_booking_code(prefix: &str) -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    let mut code = format!("{prefix}-");
    for _ in 0..6 {
        let idx = rng.gen_range(0..CHARS.len());
        code.push(CHARS[idx] as char);
    }
    code
}

/// First-letter-of-each-slug-segment brand prefix.
pub fn brand_prefix(slug: &str) -> String {
    let p: String = slug
        .split('-')
        .filter_map(|s| s.chars().next())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if p.is_empty() {
        "BK".to_string()
    } else {
        p
    }
}

/// Format an integer with vi-VN thousand-separators.
pub fn fmt_vnd(n: i64) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let len = bytes.len();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (i, b) in bytes.iter().enumerate() {
        if i > 0 && (len - i) % 3 == 0 {
            out.push('.');
        }
        out.push(*b as char);
    }
    out
}

/// Convert a 64-bit integer to base36.
pub fn to_base36(mut n: i64) -> String {
    if n == 0 {
        return "0".into();
    }
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        let idx = (n % 36) as usize;
        out.push(DIGITS[idx] as char);
        n /= 36;
    }
    out.reverse();
    out.into_iter().collect()
}

/// Parse the `photos` JSON column → Vec<String>.
pub fn parse_photos(raw: &str) -> Vec<String> {
    if raw.is_empty() {
        return Vec::new();
    }
    let v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// Current UTC time as ISO 8601 string.
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Current UTC time + N seconds as ISO 8601 string.
fn now_plus_iso(secs: i64) -> String {
    (Utc::now() + chrono::Duration::seconds(secs))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_phone_leading_zero() {
        assert_eq!(normalize_phone("0912345678"), "+84912345678");
    }

    #[test]
    fn normalize_phone_strips_whitespace() {
        assert_eq!(normalize_phone(" 0912 345 678 "), "+84912345678");
    }

    #[test]
    fn normalize_phone_already_84_prefixed() {
        assert_eq!(normalize_phone("84912345678"), "+84912345678");
    }

    #[test]
    fn gen_booking_code_has_prefix_and_six_chars() {
        let c = gen_booking_code("PT");
        assert!(c.starts_with("PT-"));
        let suffix = &c[3..];
        assert_eq!(suffix.len(), 6);
    }

    #[test]
    fn brand_prefix_phuong_trang() {
        assert_eq!(brand_prefix("phuong-trang"), "PT");
    }

    #[test]
    fn brand_prefix_single_word() {
        assert_eq!(brand_prefix("vietanh"), "V");
    }

    #[test]
    fn brand_prefix_empty_returns_bk() {
        assert_eq!(brand_prefix(""), "BK");
    }

    #[test]
    fn fmt_vnd_under_thousand() {
        assert_eq!(fmt_vnd(999), "999");
    }

    #[test]
    fn fmt_vnd_exactly_thousand() {
        assert_eq!(fmt_vnd(1000), "1.000");
    }

    #[test]
    fn fmt_vnd_million() {
        assert_eq!(fmt_vnd(1_500_000), "1.500.000");
    }

    #[test]
    fn to_base36_zero() {
        assert_eq!(to_base36(0), "0");
    }

    #[test]
    fn to_base36_ten_is_a() {
        assert_eq!(to_base36(10), "a");
    }

    #[test]
    fn to_base36_thirty_six_is_10() {
        assert_eq!(to_base36(36), "10");
    }

    #[test]
    fn parse_photos_valid_json_array() {
        let v = parse_photos(r#"["a.jpg","b.jpg"]"#);
        assert_eq!(v, vec!["a.jpg", "b.jpg"]);
    }

    #[test]
    fn parse_photos_garbage_is_empty() {
        assert!(parse_photos("not-json").is_empty());
    }
}
