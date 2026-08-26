//! Booking service — business logic for booking CRUD, hold, confirm, cancel.
//!
//! Ported from `booking-rs/logic/bookings.rs`, adapted to the template's
//! store + `AppError` architecture.
//!
//! ## Design
//! - Uses `CompositeStore` for all DB access (BookingStore, TripStore,
//!   ScheduleStore, RouteStore, BrandStore, PlaceStore).
//! - Returns typed DTOs from [`crate::dto::booking`] (no `serde_json::Value`).
//! - Pure helpers (normalize_phone, gen_booking_code, etc.) are ported as-is.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use rand::Rng;
use sea_orm::{Set, TransactionTrait};
use uuid::Uuid;

use crate::dto::booking::{
    BookingBrandPreview, BookingBusLayoutPreview, BookingCancelResponse, BookingConfirmResponse,
    BookingHoldResponse, BookingListItem, BookingListResponse, BookingLookupResponse,
    BookingRoutePreview, BookingSeatOut, BookingTripPreview, HoldReq, PickupPointOut,
};
use crate::entity::{booking, booking_seat, campaign, seat, seat_inventory, trip_session};
use crate::error::{AppError, AppResult};
use crate::store::CompositeStore;

// Re-export the request DTOs at the service-module root so existing
// `use crate::service::booking_service::HoldReq` references still resolve.
pub use crate::dto::booking::{
    CancelReq as CancelReqDto, ConfirmReq as ConfirmReqDto, HoldReq as HoldReqDto,
    PassengerReq as PassengerReqDto,
};

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
    ) -> AppResult<BookingListResponse> {
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

        // Build the departure-date filter for the status bucket. Single SQL
        // JOIN replaces the previous "load all trips departing today →
        // filter bookings by trip_session_id IN (...)" pattern that
        // materialised ~18k trip rows on every authenticated /bookings
        // request after a year of operation.
        let (date_gte, date_lt): (Option<&str>, Option<&str>) = match status_param.as_str() {
            "confirmed" | "upcoming" => (Some(&today_prefix), None),
            "completed" | "past" => (None, Some(&today_prefix)),
            _ => (None, None),
        };

        let bookings = self
            .store
            .booking_store()
            .list_bookings_by_user_with_date_filter(
                user_id,
                &status_param,
                date_gte,
                date_lt,
                limit,
                offset,
            )
            .await?;

        // Batch serialize
        let items = self.serialize_bookings_batched(&bookings, true).await?;

        // Use `with_total` so the field is omitted from JSON when the count
        // wasn't computed (matches the OpenAPI schema where `total` is
        // optional). Previously `total = items.len()` was misleadingly
        // reporting the page size as the total matching-row count.
        Ok(BookingListResponse::new(items))
    }

    /// Guest lookup by booking code and/or phone.
    pub async fn lookup(
        &self,
        phone: Option<&str>,
        code: Option<&str>,
    ) -> AppResult<BookingLookupResponse> {
        let code = code.map(|s| s.trim()).filter(|s| !s.is_empty());
        let phone = phone.map(|s| s.trim()).filter(|s| !s.is_empty());

        if code.is_none() && phone.is_none() {
            return Ok(BookingLookupResponse { items: Vec::new() });
        }

        let bookings = self
            .store
            .booking_store()
            .lookup_bookings(code, phone, 20)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let items = self.serialize_bookings_batched(&bookings, false).await?;

        Ok(BookingLookupResponse { items })
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
    pub async fn detail(&self, user_id: Option<&str>, id: Uuid) -> AppResult<BookingListItem> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // Ownership check
        if let Some(uid) = user_id {
            if b.user_id.map(|id| id.to_string()).as_deref() != Some(uid) {
                return Err(AppError::Forbidden("not your booking".into()));
            }
        }

        // Fetch booking seats + trip concurrently (independent of each other).
        let booking_id_str = b.id.to_string();
        let trip_id =
            Uuid::parse_str(&b.trip_session_id).map_err(|e| AppError::Internal(e.to_string()))?;

        let store = self.store.clone();
        let (seats, trip) = tokio::try_join!(
            async {
                store
                    .booking_store()
                    .list_booking_seats(&booking_id_str)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
            },
            async {
                store
                    .trip_store()
                    .find_trip_by_id(trip_id)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?
                    .ok_or_else(|| AppError::NotFound("trip not found".into()))
            }
        )?;

        // Fetch seat definitions (depends on seats).
        let seat_ids: Vec<String> = seats.iter().map(|s| s.seat_id.to_string()).collect();
        let seat_defs = self.fetch_seat_defs(&seat_ids).await?;

        // Fetch schedule (depends on trip).
        let schedule = self
            .store
            .schedule_store()
            .find_schedule_by_id(trip.schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        // Fetch route (depends on schedule).
        let route_id = schedule.route_id;
        let route_model = self
            .store
            .route_store()
            .find_route_by_id(route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        // ── Concurrent fetch of independent relations ────────────
        // brand, start_place, end_place, bus_layout, pickup_points all
        // depend only on `route_model` / `schedule` (already loaded).
        // Running them in parallel cuts ~5 sequential round-trips to 1.
        let store = self.store.clone();
        let brand_id = route_model.brand_id;
        let start_location_id = route_model.start_location_id;
        let end_location_id = route_model.end_location_id;
        let bus_layout_id = schedule.bus_layout_id.clone();
        let route_id_str = route_model.id.to_string();

        let (brand_model, start_place, end_place, bus_layout, pickup_points) = tokio::try_join!(
            async {
                // Brand
                match brand_id {
                    Some(uid) => store
                        .brand_store()
                        .get_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // Start place
                match start_location_id {
                    Some(uid) => store
                        .place_store()
                        .find_place_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // End place
                match end_location_id {
                    Some(uid) => store
                        .place_store()
                        .find_place_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // Bus layout
                match bus_layout_id
                    .as_ref()
                    .and_then(|blid| Uuid::parse_str(blid).ok())
                {
                    Some(uid) => store
                        .schedule_store()
                        .find_bus_layout_by_id(uid)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string())),
                    None => Ok(None),
                }
            },
            async {
                // Pickup points
                store
                    .route_store()
                    .list_pickup_points_by_route(&route_id_str)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))
            }
        )?;

        // Build response
        let seats_json: Vec<BookingSeatOut> = seats
            .iter()
            .map(|bs| {
                let seat = seat_defs.get(&bs.seat_id.to_string());
                BookingSeatOut {
                    seat_id: None,
                    seat_code: seat.map(|s| s.seat_label.clone()),
                    seat_class: seat.and_then(|s| s.seat_class.clone()),
                    passenger_name: bs.passenger_name.clone(),
                    passenger_type: bs.passenger_type.clone(),
                    passenger_age: bs.passenger_age.map(|n| n as i64),
                    price: Some(bs.price),
                }
            })
            .collect();

        let pickup_items: Vec<PickupPointOut> = pickup_points
            .iter()
            .map(|p| PickupPointOut {
                id: p.id,
                name: p.name.clone(),
                stop_order: Some(p.stop_order),
                lat: p.lat,
                lon: p.lon,
                kind: p.kind.clone(),
                address: p.address.clone(),
            })
            .collect();

        Ok(BookingListItem {
            id: b.id,
            code: b.code,
            status: b.status,
            adult_count: Some(b.adult_count),
            child_count: Some(b.child_count),
            subtotal: b.subtotal,
            discount: b.discount,
            fees: b.fees,
            total: b.total,
            currency: b.currency,
            expires_at: b.expires_at,
            created_at: b.created_at,
            updated_at: Some(b.updated_at),
            contact_name: b.contact_name,
            contact_phone: b.contact_phone,
            contact_email: b.contact_email,
            boarding_point_id: b.boarding_point_id.map(|id| id.to_string()),
            dropping_point_id: b.dropping_point_id.map(|id| id.to_string()),
            payment_method: None,
            paid_at: None,
            seats: seats_json,
            trip: Some(BookingTripPreview {
                id: trip.id,
                departure_at: trip.actual_departure_at,
                departure_date: Some(trip.departure_date),
                status: Some(trip.status),
                route_name: None,
                brand_name: None,
                brand_accent: None,
                brand_logo: None,
                vehicle_type: None,
                route: Some(BookingRoutePreview {
                    name: route_model.name,
                    from: start_place.map(|p| p.name.clone()),
                    to: end_place.map(|p| p.name.clone()),
                    brand: BookingBrandPreview {
                        name: brand_model.as_ref().map(|b| b.name.clone()),
                        accent_color: brand_model.as_ref().and_then(|b| b.accent_color.clone()),
                        logo_url: brand_model.as_ref().and_then(|b| b.logo_url.clone()),
                    },
                }),
                bus_layout: Some(BookingBusLayoutPreview {
                    name: bus_layout.as_ref().and_then(|l| l.name.clone()),
                    vehicle_type: bus_layout.as_ref().and_then(|l| l.vehicle_type.clone()),
                }),
                pickup_points: pickup_items,
            }),
        })
    }

    // ── Writes ───────────────────────────────────────────────────

    /// Create a booking (alias of hold). When called from an authenticated
    /// route, prefer `hold_with_user` so the booking is bound to its owner
    /// (BOLA defense on subsequent cancel/confirm calls).
    pub async fn create(&self, req: &HoldReq) -> AppResult<BookingHoldResponse> {
        self.hold(None, req).await
    }

    /// Like `hold` but binds the booking to the authenticated caller.
    /// Use this from any authenticated booking-creation route so that
    /// subsequent cancel/confirm calls can verify ownership.
    pub async fn hold_with_user(
        &self,
        user_id: Uuid,
        req: &HoldReq,
    ) -> AppResult<BookingHoldResponse> {
        self.hold(Some(user_id), req).await
    }

    /// Lock seats + create a pending booking (10-minute hold).
    ///
    /// **Authorization**: `caller_user_id` is bound to the booking row
    /// so subsequent cancel/confirm calls can verify ownership (BOLA
    /// defense). Use `None` only from anonymous/guest booking flows
    /// (and ensure guest bookings cannot be cancelled/confirmed via
    /// the authenticated cancel/confirm routes — they use the lookup
    /// route instead).
    pub async fn hold(
        &self,
        caller_user_id: Option<Uuid>,
        req: &HoldReq,
    ) -> AppResult<BookingHoldResponse> {
        // Validate inputs
        if req.seat_ids.is_empty()
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
        let trip = self
            .store
            .trip_store()
            .find_trip_by_id(req.trip_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("trip not found".into()))?;

        if trip.status == "cancelled" {
            return Err(AppError::BadRequest("trip is cancelled".into()));
        }

        // Fetch schedule + route + brand
        let schedule = self
            .store
            .schedule_store()
            .find_schedule_by_id(trip.schedule_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("schedule not found".into()))?;

        let route_model = self
            .store
            .route_store()
            .find_route_by_id(schedule.route_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("route not found".into()))?;

        let brand_model = if let Some(bid) = route_model.brand_id {
            self.store
                .brand_store()
                .get_by_id(bid)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
        } else {
            None
        };

        // Fetch seat inventories
        let seat_uuids: Vec<String> = req.seat_ids.iter().map(|s| s.to_string()).collect();
        let seat_invs = self
            .store
            .trip_store()
            .list_seat_inventories(&req.trip_id.to_string(), seat_uuids.clone())
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
            return Err(AppError::Conflict(
                "some seats are no longer available".into(),
            ));
        }

        // Pricing
        let adult_count = req
            .passengers
            .iter()
            .filter(|p| p.passenger_type == "adult")
            .count() as i64;
        let child_count = req
            .passengers
            .iter()
            .filter(|p| p.passenger_type == "child")
            .count() as i64;
        let seat_prices: Vec<i64> = seat_invs.iter().map(|s| s.final_price).collect();
        let subtotal: i64 = seat_prices.iter().sum();

        // Campaign discount
        let mut discount: i64 = 0;
        let mut applied_campaign_id: Option<String> = None;
        if let Some(ref cc) = req.campaign_code {
            let code = cc.trim().to_uppercase();
            let now = now_iso();
            let campaign = self
                .store
                .trip_store()
                .find_active_campaign(&code, &now)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;

            if let Some(c) = campaign {
                match c.discount_type.as_str() {
                    "percent" => {
                        let raw =
                            ((subtotal as f64) * c.discount_value as f64 / 100.0).round() as i64;
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
            // Bind the booking to its owner so subsequent cancel/confirm
            // calls can verify `booking.user_id == caller_user_id`.
            user_id: Set(caller_user_id),
            trip_session_id: Set(req.trip_id.to_string()),
            boarding_point_id: Set(Some(req.boarding_point_id)),
            dropping_point_id: Set(Some(req.dropping_point_id)),
            adult_count: Set(adult_count),
            child_count: Set(child_count),
            subtotal: Set(subtotal),
            discount: Set(discount),
            fees: Set(fees),
            total: Set(total),
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

        self.store
            .booking_store()
            .insert_booking(booking_model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Batch-insert all booking_seat rows in a single INSERT.
        // Replaces the per-seat loop (N round-trips).
        let bs_models: Vec<booking_seat::ActiveModel> = seat_invs
            .iter()
            .enumerate()
            .map(|(i, inv)| {
                let passenger = &req.passengers[i];
                booking_seat::ActiveModel {
                    id: Set(Uuid::new_v4()),
                    booking_id: Set(booking_id),
                    seat_id: Set(inv.seat_id),
                    passenger_name: Set(Some(passenger.name.clone())),
                    passenger_type: Set(Some(passenger.passenger_type.clone())),
                    passenger_age: Set(Some(passenger.age as i16)),
                    price: Set(inv.final_price),
                    ..Default::default()
                }
            })
            .collect();
        self.store
            .booking_store()
            .insert_booking_seats_batch(bs_models)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

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
        let trip_id_str = req.trip_id.to_string();
        let mut claimed: Vec<String> = Vec::with_capacity(seat_invs.len());
        let mut conflict = false;
        for inv in &seat_invs {
            let seat_id_str = inv.seat_id.to_string();
            let ok = self
                .store
                .trip_store()
                .try_hold_seat(&trip_id_str, &seat_id_str, &booking_id_str, &expires_at)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if ok {
                claimed.push(seat_id_str);
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
                let _ = self
                    .store
                    .trip_store()
                    .release_held_seat(&trip_id_str, seat_id, &booking_id_str)
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
        self.store
            .trip_store()
            .update_trip_session(trip_active)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Increment campaign usage — propagate the error (previously
        // swallowed via `let _ =`, leaving the campaign counter wrong).
        if let Some(ref cid) = applied_campaign_id {
            let c_uuid = Uuid::parse_str(cid).map_err(|e| AppError::Internal(e.to_string()))?;
            if let Some(c) = self
                .store
                .trip_store()
                .find_campaign_by_id(c_uuid)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
            {
                let current_used = c.used_count;
                let mut active: campaign::ActiveModel = c.into();
                active.used_count = Set(current_used + 1);
                self.store
                    .trip_store()
                    .update_campaign(active)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
            }
        }

        // Build response
        let seats_json: Vec<BookingSeatOut> = seat_invs
            .iter()
            .enumerate()
            .map(|(i, inv)| {
                let passenger = &req.passengers[i];
                BookingSeatOut {
                    seat_id: Some(inv.seat_id),
                    seat_code: None,
                    seat_class: None,
                    passenger_name: Some(passenger.name.clone()),
                    passenger_type: Some(passenger.passenger_type.clone()),
                    passenger_age: Some(passenger.age),
                    price: Some(inv.final_price),
                }
            })
            .collect();

        Ok(BookingHoldResponse {
            booking_id,
            code,
            status: "pending".to_string(),
            subtotal,
            discount,
            fees,
            total,
            expires_at,
            seats: seats_json,
            campaign_id: applied_campaign_id,
        })
    }

    /// Cancel a booking (with refund calculation).
    ///
    /// Refund policy:
    ///   - > 24h before departure → 90% refund
    ///   - > 4h before departure → 50% refund
    ///   - ≤ 4h before departure → 0% refund
    ///
    /// **Authorization**: `caller_user_id` must equal `booking.user_id`
    /// or the caller must hold the `bookings:cancel:any` permission
    /// (e.g. an admin/support role). Returns 403 Forbidden otherwise —
    /// this is a per-row ownership check that prevents BOLA on the
    /// cancel endpoint.
    pub async fn cancel(
        &self,
        caller_user_id: Uuid,
        id: Uuid,
        reason: Option<&str>,
    ) -> AppResult<BookingCancelResponse> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // BOLA defense: verify the caller owns this booking. Admins
        // (employees) don't reach this code path through the public
        // cancel route — they use the admin cancel route under
        // `/api/admin/bookings/{id}/cancel` which checks RBAC instead.
        if b.user_id != Some(caller_user_id) {
            return Err(AppError::Forbidden("not your booking".into()));
        }

        if b.status == "cancelled" {
            return Err(AppError::BadRequest("booking already cancelled".into()));
        }

        // Fetch trip for refund calculation
        let trip_id =
            Uuid::parse_str(&b.trip_session_id).map_err(|e| AppError::Internal(e.to_string()))?;
        let trip = self
            .store
            .trip_store()
            .find_trip_by_id(trip_id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let hours_until =
            if let Some(ref dep) = trip.as_ref().and_then(|t| t.actual_departure_at.clone()) {
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

        // Release held seats — single bulk UPDATE (replaces the previous
        // N-row load + N sequential UPDATE loop) + update trip + mark
        // booking cancelled, all in a single DB transaction. If any step
        // fails, the entire operation rolls back — no orphaned seats,
        // no half-cancelled bookings.
        let booking_id_str = b.id.to_string();
        let booking_code = b.code.clone();
        let reason_owned = reason.map(|s| s.to_string());

        let db = self.store.db();
        let txn_result = db
            .transaction::<_, BookingCancelResponse, AppError>(|txn| {
                Box::pin(async move {
                    // 1. Bulk-release held seats (single UPDATE)
                    use crate::entity::{
                        booking as booking_entity, seat_inventory, trip_session as trip_entity,
                    };
                    use sea_orm::sea_query::Expr;
                    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

                    let released = seat_inventory::Entity::update_many()
                        .col_expr(seat_inventory::Column::Status, Expr::value("available"))
                        .col_expr(
                            seat_inventory::Column::HeldUntil,
                            Expr::value(None::<String>),
                        )
                        .col_expr(
                            seat_inventory::Column::HeldByBookingId,
                            Expr::value(None::<String>),
                        )
                        .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id_str.clone()))
                        .exec(txn)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string()))?;
                    let seat_count = released.rows_affected as i64;

                    // 2. Re-add available seats to trip session
                    if let Some(t) = &trip {
                        let current_available = t.available_seats;
                        trip_entity::Entity::update_many()
                            .col_expr(
                                trip_entity::Column::AvailableSeats,
                                Expr::value(current_available + seat_count),
                            )
                            .filter(trip_entity::Column::Id.eq(t.id))
                            .exec(txn)
                            .await
                            .map_err(|e| AppError::Internal(e.to_string()))?;
                    }

                    // 3. Mark booking cancelled
                    booking_entity::Entity::update_many()
                        .col_expr(booking_entity::Column::Status, Expr::value("cancelled"))
                        .col_expr(booking_entity::Column::UpdatedAt, Expr::value(now_iso()))
                        .filter(booking_entity::Column::Id.eq(booking_id_str.clone()))
                        .exec(txn)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string()))?;

                    // 4. Generate cancellation reference code
                    let ts_b36 = to_base36(Utc::now().timestamp_millis());
                    let ref_code = format!(
                        "HX-{}-{}",
                        booking_code.to_uppercase(),
                        ts_b36.to_uppercase()
                    );

                    Ok(BookingCancelResponse {
                        success: true,
                        refund_percent,
                        refund_amount,
                        cancelled_at: now_iso(),
                        ref_code,
                        reason: reason_owned,
                    })
                })
            })
            .await
            .map_err(|e| match e {
                sea_orm::TransactionError::Connection(e) => {
                    AppError::Internal(format!("transaction start failed: {e}"))
                }
                sea_orm::TransactionError::Transaction(app_err) => app_err,
            })?;

        Ok(txn_result)
    }

    /// Confirm a booking (mark paid — locked → booked).
    ///
    /// **Authorization**: `caller_user_id` must equal `booking.user_id`.
    /// Returns 403 Forbidden otherwise — same BOLA defense as `cancel`.
    pub async fn confirm(
        &self,
        caller_user_id: Uuid,
        id: Uuid,
        payment_method: &str,
    ) -> AppResult<BookingConfirmResponse> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        // BOLA defense: only the booking owner can confirm.
        if b.user_id != Some(caller_user_id) {
            return Err(AppError::Forbidden("not your booking".into()));
        }

        if b.status != "pending" {
            return Err(AppError::BadRequest(
                "booking is not in pending status".into(),
            ));
        }
        self.confirm_inner(&b, payment_method).await
    }

    /// System-level confirm — used by the payment service after a verified
    /// IPN webhook or admin manual status update. No caller_user_id, so no
    /// per-row ownership check (the booking is being confirmed because
    /// payment has been verified, not because a user clicked a button).
    pub async fn confirm_as_system(
        &self,
        id: Uuid,
        payment_method: &str,
    ) -> AppResult<BookingConfirmResponse> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if b.status != "pending" {
            return Err(AppError::BadRequest(
                "booking is not in pending status".into(),
            ));
        }
        self.confirm_inner(&b, payment_method).await
    }

    /// Shared inner confirm logic — assumes ownership has already been
    /// verified by the caller (either `confirm` for user-facing callers,
    /// or `confirm_as_system` for server-side callers).
    async fn confirm_inner(
        &self,
        b: &booking::Model,
        payment_method: &str,
    ) -> AppResult<BookingConfirmResponse> {
        // Check expiry
        if let Some(ref exp) = b.expires_at {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(exp) {
                if t.with_timezone(&Utc) < Utc::now() {
                    // Expired — release seats + mark cancelled in a transaction.
                    // Previously: per-seat loop with `let _ =` swallowing errors.
                    let booking_id_str = b.id.to_string();
                    let db = self.store.db();
                    db.transaction::<_, (), AppError>(|txn| {
                        Box::pin(async move {
                            use crate::entity::{booking as booking_entity, seat_inventory};
                            use sea_orm::sea_query::Expr;
                            use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

                            seat_inventory::Entity::update_many()
                                .col_expr(seat_inventory::Column::Status, Expr::value("available"))
                                .col_expr(
                                    seat_inventory::Column::HeldUntil,
                                    Expr::value(None::<String>),
                                )
                                .col_expr(
                                    seat_inventory::Column::HeldByBookingId,
                                    Expr::value(None::<String>),
                                )
                                .filter(
                                    seat_inventory::Column::HeldByBookingId
                                        .eq(booking_id_str.clone()),
                                )
                                .exec(txn)
                                .await
                                .map_err(|e| AppError::Internal(e.to_string()))?;

                            booking_entity::Entity::update_many()
                                .col_expr(booking_entity::Column::Status, Expr::value("cancelled"))
                                .col_expr(booking_entity::Column::UpdatedAt, Expr::value(now_iso()))
                                .filter(booking_entity::Column::Id.eq(booking_id_str))
                                .exec(txn)
                                .await
                                .map_err(|e| AppError::Internal(e.to_string()))?;
                            Ok(())
                        })
                    })
                    .await
                    .map_err(|e| match e {
                        sea_orm::TransactionError::Connection(e) => {
                            AppError::Internal(format!("transaction start failed: {e}"))
                        }
                        sea_orm::TransactionError::Transaction(app_err) => app_err,
                    })?;

                    return Err(AppError::Gone("booking hold has expired".into()));
                }
            }
        }

        // Convert locked → booked + update booking status in a single
        // transaction. Previously: per-seat loop (N UPDATEs) + booking
        // UPDATE, all untransactional — a partial failure left some seats
        // "held" with a "confirmed" booking.
        let booking_id_str = b.id.to_string();
        let booking_id = b.id; // Uuid is Copy — used in the response.
        let payment_method_owned = payment_method.to_string();
        let db = self.store.db();
        let txn_result = db
            .transaction::<_, BookingConfirmResponse, AppError>(|txn| {
                Box::pin(async move {
                    use crate::entity::{booking as booking_entity, seat_inventory};
                    use sea_orm::sea_query::Expr;
                    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

                    // 1. Bulk flip held → booked (single UPDATE)
                    seat_inventory::Entity::update_many()
                        .col_expr(seat_inventory::Column::Status, Expr::value("booked"))
                        .col_expr(
                            seat_inventory::Column::HeldUntil,
                            Expr::value(None::<String>),
                        )
                        .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id_str.clone()))
                        .filter(seat_inventory::Column::Status.eq("held"))
                        .exec(txn)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string()))?;

                    // 2. Update booking status + payment method
                    booking_entity::Entity::update_many()
                        .col_expr(booking_entity::Column::Status, Expr::value("confirmed"))
                        .col_expr(
                            booking_entity::Column::PaymentMethod,
                            Expr::value(Some(payment_method_owned.clone())),
                        )
                        .col_expr(booking_entity::Column::UpdatedAt, Expr::value(now_iso()))
                        .filter(booking_entity::Column::Id.eq(booking_id_str))
                        .exec(txn)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string()))?;

                    Ok(BookingConfirmResponse {
                        booking_id,
                        status: "confirmed".to_string(),
                        payment_method: payment_method_owned,
                    })
                })
            })
            .await
            .map_err(|e| match e {
                sea_orm::TransactionError::Connection(e) => {
                    AppError::Internal(format!("transaction start failed: {e}"))
                }
                sea_orm::TransactionError::Transaction(app_err) => app_err,
            })?;

        Ok(txn_result)
    }

    // ── Batched serializer ───────────────────────────────────────

    /// Batched bookings serializer — fetches related data in bulk to avoid N+1.
    async fn serialize_bookings_batched(
        &self,
        bookings: &[booking::Model],
        include_boarding_dropping_ids: bool,
    ) -> AppResult<Vec<BookingListItem>> {
        if bookings.is_empty() {
            return Ok(Vec::new());
        }

        // Collect trip session IDs
        let trip_session_ids: Vec<String> =
            bookings.iter().map(|b| b.trip_session_id.clone()).collect();

        // Batch fetch trip sessions
        let trip_uuids: Vec<Uuid> = trip_session_ids
            .iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect();
        let trips: HashMap<String, trip_session::Model> = self
            .store
            .trip_store()
            .list_trips_by_ids(trip_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|t| (t.id.to_string(), t))
            .collect();

        // Batch fetch schedules
        let schedule_uuids: Vec<Uuid> = trips.values().map(|t| t.schedule_id).collect();
        let schedules: HashMap<String, crate::entity::schedule::Model> = self
            .store
            .schedule_store()
            .list_schedules_by_ids(schedule_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|s| (s.id.to_string(), s))
            .collect();

        // Batch fetch routes
        let route_uuids: Vec<Uuid> = schedules.values().map(|s| s.route_id).collect();
        let routes: HashMap<String, crate::entity::route::Model> = self
            .store
            .route_store()
            .list_routes_by_ids(route_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|r| (r.id.to_string(), r))
            .collect();

        // Batch fetch brands
        let brand_uuids: Vec<Uuid> = routes.values().filter_map(|r| r.brand_id).collect();
        let brands: HashMap<String, crate::entity::brand::Model> = self
            .store
            .brand_store()
            .list_brands_by_ids(brand_uuids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .into_iter()
            .map(|b| (b.id.to_string(), b))
            .collect();

        // Batch fetch booking seats
        let booking_ids: Vec<String> = bookings.iter().map(|b| b.id.to_string()).collect();
        let all_seats: Vec<booking_seat::Model> = self
            .store
            .booking_store()
            .list_booking_seats_by_booking_ids(booking_ids)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let mut seats_by_booking: HashMap<String, Vec<&booking_seat::Model>> = HashMap::new();
        for bs in &all_seats {
            seats_by_booking
                .entry(bs.booking_id.to_string())
                .or_default()
                .push(bs);
        }

        // Build per-booking DTO
        let mut items: Vec<BookingListItem> = Vec::with_capacity(bookings.len());
        for b in bookings {
            let trip = trips.get(&b.trip_session_id);
            let schedule = trip.and_then(|t| schedules.get(&t.schedule_id.to_string()));
            let route = schedule.and_then(|s| routes.get(&s.route_id.to_string()));
            let brand = route
                .and_then(|r| r.brand_id.map(|id| id.to_string()))
                .as_deref()
                .and_then(|bid| brands.get(bid));

            let trip_preview = if let (Some(t), Some(s), Some(r)) = (trip, schedule, route) {
                Some(BookingTripPreview {
                    id: t.id,
                    departure_at: t.actual_departure_at.clone(),
                    departure_date: Some(t.departure_date.clone()),
                    status: Some(t.status.clone()),
                    route_name: Some(r.name.clone()),
                    brand_name: brand.map(|b| b.name.clone()),
                    brand_accent: brand
                        .and_then(|b| b.accent_color.clone())
                        .or_else(|| Some("#0d9488".into())),
                    brand_logo: brand.and_then(|b| b.logo_url.clone()),
                    vehicle_type: s.bus_layout_id.clone(),
                    route: None,
                    bus_layout: None,
                    pickup_points: Vec::new(),
                })
            } else {
                None
            };

            let booking_seats: &[&booking_seat::Model] = seats_by_booking
                .get(&b.id.to_string())
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

            let seats_json: Vec<BookingSeatOut> = booking_seats
                .iter()
                .map(|bs| BookingSeatOut {
                    seat_id: Some(bs.seat_id),
                    seat_code: None,
                    seat_class: None,
                    passenger_name: bs.passenger_name.clone(),
                    passenger_type: bs.passenger_type.clone(),
                    passenger_age: bs.passenger_age.map(|n| n as i64),
                    price: Some(bs.price),
                })
                .collect();

            let paid_at = if b.status == "confirmed" {
                Some(b.updated_at.clone())
            } else {
                None
            };

            // When `include_boarding_dropping_ids=false` (lookup path),
            // we omit the boarding/dropping point ids + payment method from
            // the response — they're considered sensitive/internal.
            let (boarding_point_id, dropping_point_id, payment_method) =
                if include_boarding_dropping_ids {
                    (
                        b.boarding_point_id.map(|id| id.to_string()),
                        b.dropping_point_id.map(|id| id.to_string()),
                        b.payment_method.clone(),
                    )
                } else {
                    (None, None, None)
                };

            items.push(BookingListItem {
                id: b.id,
                code: b.code.clone(),
                status: b.status.clone(),
                adult_count: None,
                child_count: None,
                subtotal: b.subtotal,
                discount: b.discount,
                fees: b.fees,
                total: b.total,
                currency: b.currency.clone(),
                expires_at: b.expires_at.clone(),
                created_at: b.created_at.clone(),
                updated_at: Some(b.updated_at.clone()),
                contact_name: b.contact_name.clone(),
                contact_phone: b.contact_phone.clone(),
                contact_email: b.contact_email.clone(),
                boarding_point_id,
                dropping_point_id,
                payment_method,
                paid_at,
                seats: seats_json,
                trip: trip_preview,
            });
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
        let rows = self
            .store
            .trip_store()
            .list_seats_by_ids(seat_ids.to_vec())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        Ok(rows.into_iter().map(|s| (s.id.to_string(), s)).collect())
    }
}

// ────────────────────────────────────────────────────────────────
//  Pure helpers (no DB, no async)
// ────────────────────────────────────────────────────────────────

/// Vietnamese phone normalization.
pub fn normalize_phone(phone: &str) -> String {
    let p: String = phone.chars().filter(|c| !c.is_whitespace()).collect();
    if let Some(rest) = p.strip_prefix('0') {
        format!("+84{rest}")
    } else if let Some(rest) = p.strip_prefix("84") {
        format!("+84{rest}")
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
        if i > 0 && (len - i).is_multiple_of(3) {
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
