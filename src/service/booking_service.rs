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
use sea_orm::Set;
use uuid::Uuid;

use crate::dto::booking::{
    BookingBrandPreview, BookingBusLayoutPreview, BookingCancelResponse, BookingConfirmResponse,
    BookingHoldResponse, BookingListItem, BookingListResponse, BookingRoutePreview, BookingSeatOut,
    BookingTripPreview, HoldReq, PickupPointOut,
};
use crate::entity::{booking, booking_seat, seat, seat_inventory, trip_session};
use crate::error::{AppError, AppResult};
use crate::payment::statuses as payment_status;
use crate::service::trip_time;
use crate::store::{CompositeStore, ConfirmOutcome};

// Re-export the request DTOs at the service-module root so existing
// `use crate::service::booking_service::HoldReq` references still resolve.
pub use crate::dto::booking::{
    CancelReq as CancelReqDto, ConfirmReq as ConfirmReqDto, HoldReq as HoldReqDto,
    PassengerReq as PassengerReqDto,
};

/// How long seats are held while the customer fills in the checkout.
const HOLD_SECS: i64 = 10 * 60;

/// How long a started payment keeps the seats.
const PAYMENT_HOLD_SECS: i64 = 15 * 60;

/// What one expiry sweep gave back.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ExpiredHolds {
    pub bookings: u64,
    pub seats: u64,
}

/// How often abandoned holds are given back.
const SWEEP_EVERY: std::time::Duration = std::time::Duration::from_secs(60);

/// Holds released per sweep; a backlog is worked off over successive sweeps.
const SWEEP_BATCH: u64 = 200;

/// Run [`BookingService::expire_stale_holds`] on a timer for the life of
/// the process. Without it a customer who walks away from the checkout
/// keeps those seats off sale for good.
pub fn spawn_hold_sweeper(bookings: Arc<BookingService>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(SWEEP_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await; // the first tick is immediate: clears what a restart left behind
            match bookings.expire_stale_holds(SWEEP_BATCH).await {
                Ok(done) if done.bookings > 0 => tracing::info!(
                    bookings = done.bookings,
                    seats = done.seats,
                    "released expired seat holds"
                ),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "seat-hold sweep failed"),
            }
        }
    });
}

/// True when the booking's hold deadline has passed.
pub fn hold_expired(b: &booking::Model) -> bool {
    b.expires_at
        .as_deref()
        .and_then(|e| chrono::DateTime::parse_from_rfc3339(e).ok())
        .is_some_and(|t| t.with_timezone(&Utc) < Utc::now())
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

        self.detail_serialize(user_id, b).await
    }

    /// Booking detail by id OR code — the frontend's deep links carry the
    /// human-facing booking code (`/bookings/{code}`), while older callers
    /// and admin tooling use the UUID. Resolution order: try UUID parse,
    /// fall back to a code lookup (codes are unique).
    pub async fn detail_by_id_or_code(
        &self,
        user_id: Option<&str>,
        id_or_code: &str,
    ) -> AppResult<BookingListItem> {
        let b = match Uuid::parse_str(id_or_code) {
            Ok(id) => self
                .store
                .booking_store()
                .find_booking_by_id(id)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?,
            Err(_) => self
                .store
                .booking_store()
                .find_booking_by_code(id_or_code)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?,
        }
        .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        self.detail_serialize(user_id, b).await
    }

    /// Shared serializer for a resolved booking row — ownership check +
    /// seats + trip + schedule join. Takes the row by value (the final
    /// `BookingListItem` moves its scalar fields out).
    async fn detail_serialize(
        &self,
        user_id: Option<&str>,
        b: booking::Model,
    ) -> AppResult<BookingListItem> {
        // Ownership check
        if let Some(uid) = user_id {
            if b.user_id.map(|id| id.to_string()).as_deref() != Some(uid) {
                return Err(AppError::Forbidden("not your booking".into()));
            }
        }

        // Fetch booking seats + trip concurrently (independent of each other).
        let booking_id_str = b.id.to_string();
        let trip_id = b.trip_session_id;

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
        // brand, bus_layout, pickup_points all depend only on
        // `route_model` / `schedule` (already loaded). Running them in
        // parallel cuts ~3 sequential round-trips to 1.
        //
        // Note: `route.start_location_id` / `route.end_location_id`
        // are now slug strings (NOT NULL), not UUID FKs to `place`.
        // The slug → city resolution is synchronous (no DB hit), so
        // we wrap it in an async block to keep the `tokio::try_join!`
        // shape uniform with the other futures.
        let store = self.store.clone();
        let brand_id = route_model.brand_id;
        let start_location_slug = route_model.start_location_id.clone();
        let end_location_slug = route_model.end_location_id.clone();
        // `Uuid` since the schedule entity fix (was a String that never
        // matched the BLOB-stored layout ids on SQLite).
        let bus_layout_id = schedule.bus_layout_id;
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
                // Start city — resolved from the hardcoded slug table.
                Ok::<_, AppError>(crate::cities::find_by_slug(&start_location_slug))
            },
            async {
                // End city — resolved from the hardcoded slug table.
                Ok::<_, AppError>(crate::cities::find_by_slug(&end_location_slug))
            },
            async {
                // Bus layout
                match bus_layout_id {
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
                    from: start_place.map(|c| c.name.to_string()),
                    to: end_place.map(|c| c.name.to_string()),
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

        // A trip that has left cannot be sold.
        if trip_time::departure_instant(
            &trip.departure_date,
            &schedule.departure_time,
            trip.actual_departure_at.as_deref(),
        )
        .is_some_and(|departs| departs <= Utc::now())
        {
            return Err(AppError::BadRequest("trip has already departed".into()));
        }

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
        let mut applied_campaign: Option<Uuid> = None;
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
                // Promos belong to the operator that issued them.
                if route_model.brand_id != Some(c.brand_id) {
                    return Err(AppError::BadRequest(
                        "this promo code does not apply to this operator".into(),
                    ));
                }
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
                applied_campaign = Some(c.id);
            } else {
                return Err(AppError::BadRequest(
                    "invalid or expired campaign code".into(),
                ));
            }
        }

        // A promo can never be worth more than the order.
        let discount = discount.clamp(0, subtotal);
        let fees: i64 = 0;
        let total = (subtotal - discount + fees).max(0);

        // 10-minute hold
        let expires_at = now_plus_iso(HOLD_SECS);
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
            trip_session_id: Set(req.trip_id),
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
            campaign_applied_id: Set(applied_campaign),
            contact_name: Set(Some(req.contact_name.clone())),
            contact_phone: Set(Some(req.contact_phone.clone())),
            contact_email: Set(req.contact_email.clone()),
            expires_at: Set(Some(expires_at.clone())),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            ..Default::default()
        };

        // Write the booking row first — the schema demands it:
        // `seat_inventory.held_by_booking_id` carries an FK to
        // `booking.id`, so seats cannot be claimed before the booking
        // exists. The row is still invisible to users (status `pending`,
        // no line items); every failure path below DELETES it again, so
        // a failed hold leaves no ghost rows behind.
        self.store
            .booking_store()
            .insert_booking(booking_model)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Claim ALL the seats in ONE conditional UPDATE (bulk hold).
        //
        // The `status = 'available'` guard closes the TOCTOU race: the
        // engine serializes the UPDATE, so concurrent holds on
        // overlapping seats resolve exactly one winner per seat; the
        // loser sees `rows_affected < seat count` and rolls back. This
        // is also the PERF-001 fix — the old per-seat loop cost one
        // round-trip per seat; the bulk claim is one round-trip for the
        // whole booking.
        //
        // The old flow's rollback released the claimed seats but never
        // un-wrote the booking + booking_seat rows it had already
        // inserted: every failed multi-seat hold left a `pending`
        // booking and its line items behind forever (nothing swept
        // `pending` rows; only a confirm/cancel attempt on that exact
        // booking would flip it). The rollback below now removes the
        // row entirely.
        let booking_id_str = booking_id.to_string();
        let trip_id_str = req.trip_id.to_string();
        let wanted = seat_uuids.len();
        let claimed = self
            .store
            .trip_store()
            .try_hold_seats_bulk(&trip_id_str, &seat_uuids, &booking_id_str, &expires_at)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if claimed != wanted as u64 {
            // Partial (or empty) claim — hand back whatever we did get,
            // then drop the never-visible booking row. The bulk release
            // is conditional on `held_by_booking_id`, so a concurrent
            // booking's hold is never clobbered, and it must run BEFORE
            // the delete (the seat_inventory claim FKs the booking row).
            // On failure the seats self-heal at `expires_at` — already
            // set by the claim — and the row stays for the same reason.
            if claimed > 0 {
                if let Err(e) = self
                    .store
                    .trip_store()
                    .release_held_seats_for_booking(&booking_id_str)
                    .await
                {
                    tracing::warn!(
                        booking_id = %booking_id_str,
                        claimed,
                        error = %e,
                        "conflict rollback failed — seats self-heal at expires_at"
                    );
                    return Err(AppError::Conflict(
                        "some seats are no longer available".into(),
                    ));
                }
            }
            let _ = self.store.booking_store().delete_booking(booking_id).await;
            return Err(AppError::Conflict(
                "some seats are no longer available".into(),
            ));
        }

        // Batch-insert all booking_seat rows in a single INSERT.
        // Replaces the per-seat loop (N round-trips). A single
        // multi-row INSERT is atomic — no partial line items on failure.
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
                    // `created_at` has a NOT NULL column without a DB
                    // default — set it explicitly or the INSERT fails.
                    created_at: Set(now_iso()),
                }
            })
            .collect();
        if let Err(e) = self
            .store
            .booking_store()
            .insert_booking_seats_batch(bs_models)
            .await
        {
            // Line items failed — release the claimed seats (clears the
            // seat_inventory FK) and drop the booking row. The failed
            // hold must leave NOTHING behind: no ghost `pending` row, no
            // seats blocked for ten minutes.
            let _ = self
                .store
                .trip_store()
                .release_held_seats_for_booking(&booking_id_str)
                .await;
            let _ = self.store.booking_store().delete_booking(booking_id).await;
            return Err(AppError::Internal(e.to_string()));
        }

        // Decrement available seats — computed in SQL
        // (`available_seats = available_seats - n`), closing the
        // lost-update race the read-modify-write had: two concurrent
        // holds both read `10`, both wrote `10 - n`, one decrement
        // vanished. The seat_inventory claim above is the correctness
        // gate; this maintains the trip's display/hint counter.
        self.store
            .trip_store()
            .decrement_available_seats(&trip_id_str, wanted as i64)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Increment campaign usage — also computed in SQL
        // (`used_count = used_count + 1`) for the same lost-update
        // reason. Errors propagate (a swallowed failure here would
        // leave the campaign counter wrong). A campaign deleted between
        // validation and this update reports 0 rows — a no-op, matching
        // the previous behaviour.
        if let Some(ref cid) = applied_campaign_id {
            let c_uuid = Uuid::parse_str(cid).map_err(|e| AppError::Internal(e.to_string()))?;
            self.store
                .trip_store()
                .increment_campaign_usage(c_uuid)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
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

    /// Cancel a booking.
    ///
    /// Refund policy (share of what was actually PAID, by notice before
    /// departure): more than 24 h → 90 %, more than 4 h → 50 %, less → 0.
    /// An unpaid booking refunds nothing.
    ///
    /// **Authorization**: only the booking's owner may cancel it (BOLA
    /// defense); staff use the admin routes, which check RBAC instead.
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
            .await?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if b.user_id != Some(caller_user_id) {
            return Err(AppError::Forbidden("not your booking".into()));
        }
        match b.status.as_str() {
            "pending" | "confirmed" => {}
            "cancelled" => return Err(AppError::BadRequest("booking already cancelled".into())),
            other => {
                return Err(AppError::BadRequest(format!(
                    "a {other} booking cannot be cancelled"
                )))
            }
        }

        let (refund_percent, refund_amount) = self.refund_for(&b).await?;

        // Seats, counter, promo use and pending payments move together or not at all.
        self.store
            .booking_store()
            .cancel_booking(id, &["pending", "confirmed"])
            .await?
            .ok_or_else(|| AppError::Conflict("booking was changed by another request".into()))?;

        let ts_b36 = to_base36(Utc::now().timestamp_millis());
        Ok(BookingCancelResponse {
            success: true,
            refund_percent,
            refund_amount,
            cancelled_at: now_iso(),
            ref_code: format!("HX-{}-{}", b.code.to_uppercase(), ts_b36.to_uppercase()),
            reason: reason.map(str::to_string),
        })
    }

    /// `(percent, amount)` handed back for cancelling `b` now: the policy
    /// share of the completed payments.
    async fn refund_for(&self, b: &booking::Model) -> AppResult<(i64, i64)> {
        let paid: i64 = self
            .store
            .payment_store()
            .list_by_booking(b.id)
            .await?
            .iter()
            .filter(|p| p.status == payment_status::COMPLETED)
            .map(|p| p.amount)
            .sum();
        if paid <= 0 {
            return Ok((0, 0));
        }

        let trip = self
            .store
            .trip_store()
            .find_trip_by_id(b.trip_session_id)
            .await?;
        let schedule = match &trip {
            Some(t) => {
                self.store
                    .schedule_store()
                    .find_schedule_by_id(t.schedule_id)
                    .await?
            }
            None => None,
        };
        let departs = trip.as_ref().zip(schedule.as_ref()).and_then(|(t, s)| {
            trip_time::departure_instant(
                &t.departure_date,
                &s.departure_time,
                t.actual_departure_at.as_deref(),
            )
        });
        let percent = match departs {
            Some(at) => trip_time::refund_percent((at - Utc::now()).num_minutes() as f64 / 60.0),
            None => {
                tracing::warn!(booking = %b.id, "cancel: departure time unknown — refunding at the top tier");
                90
            }
        };
        Ok((percent, paid * percent / 100))
    }

    /// Confirm a booking (the customer pays on the bus: held → booked).
    ///
    /// **Authorization**: the caller must own the booking — same BOLA
    /// defense as `cancel`.
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
            .await?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        if b.user_id != Some(caller_user_id) {
            return Err(AppError::Forbidden("not your booking".into()));
        }
        if b.status != "pending" {
            return Err(AppError::BadRequest(
                "booking is not in pending status".into(),
            ));
        }
        if hold_expired(&b) {
            // Too late: hand the seats back right away.
            self.store
                .booking_store()
                .expire_pending(id, &now_iso())
                .await?;
            return Err(AppError::Gone("booking hold has expired".into()));
        }
        self.confirm_pending(&b, payment_method).await
    }

    /// Confirm after a verified payment (gateway webhook, driver collecting
    /// cash, admin override). Money has changed hands, so a hold that ran
    /// past its deadline still converts as long as nothing released the
    /// seats yet. Idempotent: a repeated notification for a booking that is
    /// already confirmed succeeds.
    pub async fn confirm_as_system(
        &self,
        id: Uuid,
        payment_method: &str,
    ) -> AppResult<BookingConfirmResponse> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;

        match b.status.as_str() {
            "pending" => self.confirm_pending(&b, payment_method).await,
            "confirmed" => Ok(BookingConfirmResponse {
                booking_id: b.id,
                status: "confirmed".to_string(),
                payment_method: b
                    .payment_method
                    .unwrap_or_else(|| payment_method.to_string()),
            }),
            other => Err(AppError::Conflict(format!("booking is {other}"))),
        }
    }

    async fn confirm_pending(
        &self,
        b: &booking::Model,
        payment_method: &str,
    ) -> AppResult<BookingConfirmResponse> {
        match self
            .store
            .booking_store()
            .confirm_pending(b.id, payment_method)
            .await?
        {
            ConfirmOutcome::Confirmed => Ok(BookingConfirmResponse {
                booking_id: b.id,
                status: "confirmed".to_string(),
                payment_method: payment_method.to_string(),
            }),
            ConfirmOutcome::NotPending => Err(AppError::BadRequest(
                "booking is not in pending status".into(),
            )),
            ConfirmOutcome::SeatsLost => Err(AppError::Gone("booking hold has expired".into())),
        }
    }

    /// Give back every hold that ran out: the booking is cancelled, its
    /// seats are free again and the trip's counter is restored. Run on a
    /// timer; safe to call concurrently with confirms and cancels.
    pub async fn expire_stale_holds(&self, batch: u64) -> AppResult<ExpiredHolds> {
        let now = now_iso();
        let stale = self
            .store
            .booking_store()
            .list_expired_pending(&now, batch)
            .await?;
        let mut done = ExpiredHolds::default();
        for b in stale {
            match self.store.booking_store().expire_pending(b.id, &now).await {
                Ok(Some(released)) => {
                    done.bookings += 1;
                    done.seats += released.seats;
                }
                // Confirmed, cancelled or extended since it was listed.
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(booking = %b.id, error = %e, "could not release an expired hold");
                }
            }
        }
        Ok(done)
    }

    /// Keep a booking's seats while its payment is in progress: the
    /// customer needs longer than the initial hold to finish at a gateway.
    pub async fn extend_hold_for_payment(&self, id: Uuid) -> AppResult<bool> {
        Ok(self
            .store
            .booking_store()
            .extend_hold(id, &now_plus_iso(PAYMENT_HOLD_SECS))
            .await?)
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

        // Collect trip session IDs (Uuids since the entity column is
        // typed `Uuid` — see entity/booking.rs for the SQLite FK rationale).
        let trip_uuids: Vec<Uuid> = bookings.iter().map(|b| b.trip_session_id).collect();
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
            let trip = trips.get(&b.trip_session_id.to_string());
            let schedule = trip.and_then(|t| schedules.get(&t.schedule_id.to_string()));
            let route = schedule.and_then(|s| routes.get(&s.route_id.to_string()));
            let brand = route
                .and_then(|r| r.brand_id.map(|id| id.to_string()))
                .as_deref()
                .and_then(|bid| brands.get(bid));

            let trip_preview = if let (Some(t), Some(s), Some(r)) = (trip, schedule, route) {
                // `departure_at`: prefer the ACTUAL departure (driver
                // check-in) but fall back to the SCHEDULED one
                // (departure_date + schedule.departure_time) so the
                // frontend's upcoming/past bucketing works before the
                // driver ever checks in.
                let departure_at = t
                    .actual_departure_at
                    .clone()
                    .or_else(|| Some(format!("{}T{}", t.departure_date, s.departure_time)));
                Some(BookingTripPreview {
                    id: t.id,
                    departure_at,
                    departure_date: Some(t.departure_date.clone()),
                    status: Some(t.status.clone()),
                    route_name: Some(r.name.clone()),
                    brand_name: brand.map(|b| b.name.clone()),
                    brand_accent: brand
                        .and_then(|b| b.accent_color.clone())
                        .or_else(|| Some("#0d9488".into())),
                    brand_logo: brand.and_then(|b| b.logo_url.clone()),
                    vehicle_type: s.bus_layout_id.map(|u| u.to_string()),
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

/// Parse the `photos` JSON column → `Vec<String>`.
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
    use crate::service::test_support::{fixture, hold_req, seed_trip_with_seats};
    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter};

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

    // ── hold flow (integration-shaped, in-memory DB) ──────────────
    //
    // Boots the full CompositeStore over a fresh in-memory DB with the
    // REAL migration schema, seeds the catalogue chain the hold flow
    // walks (brand → bus_layout → seats → route → schedule → trip →
    // seat inventory → pickup points), and exercises the booking hold
    // state machine end-to-end.

    /// THE regression: a conflicted multi-seat hold must leave NO
    /// booking / booking_seat rows behind (the pre-bulk-fix flow inserted
    /// them first and never un-wrote them on 409), and a partially
    /// claimed hold must hand its claimed seats back.
    #[tokio::test]
    async fn hold_conflict_leaves_no_orphan_rows_and_releases_partial_claims() {
        use crate::store::CompositeStore;
        use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};
        use sea_orm_migration::MigratorTrait;

        let store = CompositeStore::in_memory().await;
        migrator::Migrator::up(store.db(), None).await.unwrap();
        let svc = BookingService::new(store.clone());

        let (trip_id, seats, point) = seed_trip_with_seats(&store, 3).await;
        let [a, b, c] = [seats[0], seats[1], seats[2]];

        // 1) A clean two-seat hold succeeds and writes exactly one
        //    booking with two line items.
        let resp = svc.hold(None, &hold_req(trip_id, vec![a, b], point)).await;
        let resp = resp.expect("first hold must succeed");
        let booking_count = booking::Entity::find().count(store.db()).await.unwrap();
        assert_eq!(booking_count, 1);
        let seat_rows = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(trip_id))
            .all(store.db())
            .await
            .unwrap();
        let held_by_first: Vec<&seat_inventory::Model> =
            seat_rows.iter().filter(|s| s.status == "held").collect();
        assert_eq!(held_by_first.len(), 2, "both seats held: {:?}", seat_rows);
        // available_seats decremented atomically by the store.
        let trip = trip_session::Entity::find_by_id(trip_id)
            .one(store.db())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(trip.available_seats, 1, "3 - 2 held");

        // 2) The SAME seats again → 409 conflict AND no orphan rows.
        //    The pre-fix flow inserted the second booking + seats before
        //    discovering the conflict, leaving them forever.
        let err = svc
            .hold(None, &hold_req(trip_id, vec![a, b], point))
            .await
            .expect_err("duplicate hold must conflict");
        assert!(matches!(err, AppError::Conflict(_)), "got: {err:?}");
        let booking_count = booking::Entity::find().count(store.db()).await.unwrap();
        assert_eq!(booking_count, 1, "conflicted hold must not leave rows");
        let seat_count = booking_seat::Entity::find()
            .count(store.db())
            .await
            .unwrap();
        assert_eq!(seat_count, 2, "conflicted hold must not leave seat rows");

        // 3) Partial claim: [a (held), c (free)] — the bulk claim takes
        //    only c, sees 1 != 2, and must RELEASE c on the way out.
        let err = svc
            .hold(None, &hold_req(trip_id, vec![a, c], point))
            .await
            .expect_err("mixed hold must conflict");
        assert!(matches!(err, AppError::Conflict(_)), "got: {err:?}");
        let c_row = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::SeatId.eq(c))
            .one(store.db())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            c_row.status, "available",
            "partially claimed seat must be released back"
        );
        assert!(c_row.held_by_booking_id.is_none());
        let booking_count = booking::Entity::find().count(store.db()).await.unwrap();
        assert_eq!(booking_count, 1, "partial conflict must not leave rows");

        // 4) The still-validated response from step 1 is consistent.
        assert_eq!(resp.seats.len(), 2);
        assert_eq!(resp.status, "pending");
    }

    // ── lifecycle: confirm / cancel / expiry ──────────────────────

    #[tokio::test]
    async fn confirming_books_the_seats_and_repeats_harmlessly() {
        let f = fixture(3).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 2).await;
        assert_eq!(f.seats_now().await, (1, 2, 0, 1));

        f.svc
            .confirm_as_system(held.booking_id, "vnpay")
            .await
            .unwrap();
        let b = f.booking(held.booking_id).await;
        assert_eq!(b.status, "confirmed");
        assert_eq!(b.payment_method.as_deref(), Some("vnpay"));
        assert_eq!(f.seats_now().await, (1, 0, 2, 1));
        let rows = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::HeldByBookingId.eq(held.booking_id))
            .all(f.store.db())
            .await
            .unwrap();
        assert!(rows.iter().all(|r| r.held_until.is_none()), "{rows:?}");

        // A repeated gateway notification is not an error and changes nothing.
        let again = f
            .svc
            .confirm_as_system(held.booking_id, "vnpay")
            .await
            .unwrap();
        assert_eq!(again.status, "confirmed");
        assert_eq!(f.seats_now().await, (1, 0, 2, 1));
    }

    #[tokio::test]
    async fn only_the_owner_may_confirm_and_only_while_pending() {
        let f = fixture(2).await;
        let (owner, stranger) = (f.owner().await, f.owner().await);
        let held = f.hold(owner, 1).await;

        let err = f
            .svc
            .confirm(stranger, held.booking_id, "cod")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)), "{err:?}");
        f.svc.confirm(owner, held.booking_id, "cod").await.unwrap();
        let err = f
            .svc
            .confirm(owner, held.booking_id, "cod")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
    }

    #[tokio::test]
    async fn cancelling_frees_the_seats_the_counter_and_pending_payments() {
        let f = fixture(3).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 2).await;
        let pay = f.payment(&held, owner, "pending").await;
        assert_eq!(f.seats_now().await, (1, 2, 0, 1));

        f.svc
            .cancel(owner, held.booking_id, Some("changed my mind"))
            .await
            .unwrap();

        assert_eq!(f.booking(held.booking_id).await.status, "cancelled");
        assert_eq!(f.seats_now().await, (3, 0, 0, 3));
        assert_eq!(f.payment_status(pay).await, "cancelled");

        let err = f
            .svc
            .cancel(owner, held.booking_id, None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
        assert_eq!(f.seats_now().await, (3, 0, 0, 3), "no double release");
    }

    #[tokio::test]
    async fn cancelling_a_confirmed_booking_releases_booked_seats_too() {
        let f = fixture(2).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 2).await;
        f.svc.confirm(owner, held.booking_id, "cod").await.unwrap();
        assert_eq!(f.seats_now().await, (0, 0, 2, 0));

        f.svc.cancel(owner, held.booking_id, None).await.unwrap();
        assert_eq!(f.seats_now().await, (2, 0, 0, 2));
    }

    #[tokio::test]
    async fn only_the_owner_may_cancel() {
        let f = fixture(1).await;
        let (owner, stranger) = (f.owner().await, f.owner().await);
        let held = f.hold(owner, 1).await;
        let err = f
            .svc
            .cancel(stranger, held.booking_id, None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)), "{err:?}");
        assert_eq!(f.booking(held.booking_id).await.status, "pending");
    }

    #[tokio::test]
    async fn refund_follows_the_real_departure_and_what_was_paid() {
        for (hours, percent) in [(72, 90), (10, 50), (2, 0)] {
            let f = fixture(1).await;
            let owner = f.owner().await;
            let held = f.hold(owner, 1).await;
            f.payment(&held, owner, "completed").await;
            f.svc
                .confirm_as_system(held.booking_id, "vnpay")
                .await
                .unwrap();
            f.depart_in(hours).await;

            let r = f.svc.cancel(owner, held.booking_id, None).await.unwrap();
            assert_eq!(r.refund_percent, percent, "{hours} h before departure");
            assert_eq!(r.refund_amount, held.total * percent / 100, "{hours} h");
        }
    }

    #[tokio::test]
    async fn an_unpaid_booking_refunds_nothing() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        f.depart_in(72).await;
        let r = f.svc.cancel(owner, held.booking_id, None).await.unwrap();
        assert_eq!((r.refund_percent, r.refund_amount), (0, 0));
    }

    #[tokio::test]
    async fn the_sweep_releases_expired_holds_and_nothing_else() {
        let f = fixture(4).await;
        let owner = f.owner().await;
        let stale = f.hold(owner, 2).await;
        let pay = f.payment(&stale, owner, "pending").await;
        let fresh = f
            .svc
            .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[2]], f.point))
            .await
            .unwrap();
        let paid = f
            .svc
            .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[3]], f.point))
            .await
            .unwrap();
        f.svc
            .confirm_as_system(paid.booking_id, "vnpay")
            .await
            .unwrap();
        f.age_hold(stale.booking_id, 30).await;
        f.age_hold(paid.booking_id, 30).await; // confirmed bookings no longer expire
        assert_eq!(f.seats_now().await, (0, 3, 1, 0));

        let done = f.svc.expire_stale_holds(100).await.unwrap();

        assert_eq!(
            done,
            ExpiredHolds {
                bookings: 1,
                seats: 2
            }
        );
        assert_eq!(f.booking(stale.booking_id).await.status, "cancelled");
        assert_eq!(f.booking(fresh.booking_id).await.status, "pending");
        assert_eq!(f.booking(paid.booking_id).await.status, "confirmed");
        assert_eq!(f.seats_now().await, (2, 1, 1, 2));
        assert_eq!(f.payment_status(pay).await, "cancelled");

        let again = f.svc.expire_stale_holds(100).await.unwrap();
        assert_eq!(
            again,
            ExpiredHolds::default(),
            "a second sweep finds nothing"
        );
    }

    #[tokio::test]
    async fn expired_seats_can_be_sold_again() {
        let f = fixture(1).await;
        let (first, second) = (f.owner().await, f.owner().await);
        let abandoned = f.hold(first, 1).await;
        let err = f
            .svc
            .hold_with_user(second, &hold_req(f.trip, f.seats.clone(), f.point))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");

        f.age_hold(abandoned.booking_id, 5).await;
        f.svc.expire_stale_holds(100).await.unwrap();
        f.svc
            .hold_with_user(second, &hold_req(f.trip, f.seats.clone(), f.point))
            .await
            .expect("the seat is on sale again");
    }

    #[tokio::test]
    async fn a_customer_confirming_after_the_deadline_gets_gone_and_the_seats_back() {
        let f = fixture(2).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 2).await;
        f.age_hold(held.booking_id, 5).await;

        let err = f
            .svc
            .confirm(owner, held.booking_id, "cod")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Gone(_)), "{err:?}");
        assert_eq!(f.booking(held.booking_id).await.status, "cancelled");
        assert_eq!(f.seats_now().await, (2, 0, 0, 2));
    }

    #[tokio::test]
    async fn a_payment_that_lands_late_still_confirms_until_the_sweep_runs() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        f.age_hold(held.booking_id, 5).await;
        f.svc
            .confirm_as_system(held.booking_id, "vnpay")
            .await
            .unwrap();
        assert_eq!(f.booking(held.booking_id).await.status, "confirmed");
        assert_eq!(
            f.svc.expire_stale_holds(100).await.unwrap(),
            ExpiredHolds::default()
        );

        // Once the sweep has taken the seats back, the money cannot buy them.
        let g = fixture(1).await;
        let owner = g.owner().await;
        let held = g.hold(owner, 1).await;
        g.age_hold(held.booking_id, 5).await;
        g.svc.expire_stale_holds(100).await.unwrap();
        let err = g
            .svc
            .confirm_as_system(held.booking_id, "vnpay")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    #[tokio::test]
    async fn extending_a_hold_moves_the_deadline_out_and_never_in() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        let before = f.booking(held.booking_id).await.expires_at.unwrap();

        assert!(f
            .svc
            .extend_hold_for_payment(held.booking_id)
            .await
            .unwrap());
        let after = f.booking(held.booking_id).await.expires_at.unwrap();
        assert!(after > before, "{before} -> {after}");
        let seat = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::HeldByBookingId.eq(held.booking_id))
            .one(f.store.db())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(seat.held_until.as_deref(), Some(after.as_str()));

        // Asking for less than the current deadline changes nothing.
        let store = f.store.booking_store();
        assert!(store.extend_hold(held.booking_id, &before).await.unwrap());
        assert_eq!(f.booking(held.booking_id).await.expires_at.unwrap(), after);

        f.svc.cancel(owner, held.booking_id, None).await.unwrap();
        assert!(!f
            .svc
            .extend_hold_for_payment(held.booking_id)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn a_trip_that_has_left_cannot_be_booked() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        f.depart_in(-2).await;
        let err = f
            .svc
            .hold_with_user(owner, &hold_req(f.trip, f.seats.clone(), f.point))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
        assert_eq!(f.seats_now().await, (1, 0, 0, 1));
    }

    #[tokio::test]
    async fn a_promo_is_capped_scoped_and_returned_with_an_abandoned_hold() {
        use crate::entity::campaign;
        let f = fixture(2).await;
        let owner = f.owner().await;
        let brand = f.brand_of_trip().await;
        let promo = |code: &str, brand_id: Uuid, max_uses: Option<i64>| campaign::ActiveModel {
            id: Set(Uuid::new_v4()),
            brand_id: Set(brand_id),
            code: Set(code.into()),
            discount_type: Set("fixed_amount".into()),
            discount_value: Set(1_000_000), // more than one seat costs
            max_uses: Set(max_uses),
            used_count: Set(0),
            starts_at: Set(None), // open-ended
            ends_at: Set(None),
            status: Set("active".into()),
            created_at: Set(now_iso()),
            updated_at: Set(now_iso()),
        };
        promo("ONCE", brand, Some(1))
            .insert(f.store.db())
            .await
            .unwrap();
        promo("OTHER", Uuid::new_v4(), None)
            .insert(f.store.db())
            .await
            .ok();

        let mut req = hold_req(f.trip, vec![f.seats[0]], f.point);
        req.campaign_code = Some("once".into());
        let first = f.svc.hold_with_user(owner, &req).await.unwrap();
        assert_eq!(
            (first.discount, first.total),
            (first.subtotal, 0),
            "capped at the order"
        );
        assert!(first.campaign_id.is_some());

        // Single use: the second customer is refused while the first still holds it...
        req.seat_ids = vec![f.seats[1]];
        req.passengers.truncate(1);
        let err = f.svc.hold_with_user(owner, &req).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");

        // ...and gets it back when that hold is abandoned.
        f.age_hold(first.booking_id, 5).await;
        f.svc.expire_stale_holds(100).await.unwrap();
        f.svc
            .hold_with_user(owner, &req)
            .await
            .expect("promo returned");
    }
}
