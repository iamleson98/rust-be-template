//! Bookings from the customer's side: hold seats, place or pay, cancel, and
//! the ticket history.
//!
//! A booking starts `pending` with its seats held for the checkout. Paying
//! online confirms it (via the gateway webhook); paying on board places it
//! for the operator, who phones the customer and confirms it from the admin
//! console. Holds nobody placed or paid for are released by
//! [`spawn_hold_sweeper`].

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::Utc;
use rand::Rng;
use sea_orm::Set;
use uuid::Uuid;

use crate::dto::booking::{
    BookingCancelResponse, BookingConfirmResponse, BookingHoldResponse, BookingListResponse,
    BookingOut, BookingSeatOut, BookingStop, HoldReq, PassengerReq,
};
use crate::entity::{booking, booking_seat, seat_inventory};
use crate::error::{AppError, AppResult};
use crate::payment::providers;
use crate::payment::statuses as payment_status;
use crate::service::booking_view::{booking_view, booking_views, departure_of};
use crate::service::fares::{self, ChildPolicy, FareTable, Passenger};
use crate::service::{trip_stops, trip_time};
use crate::store::{BookingFilter, CompositeStore, ConfirmOutcome};

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

    /// The customer's tickets — bookings they placed or paid for — newest
    /// first. Checkouts never finished are not tickets.
    pub async fn list(
        &self,
        user_id: Uuid,
        limit: u64,
        offset: u64,
    ) -> AppResult<BookingListResponse> {
        let filter = BookingFilter {
            user_id: Some(user_id),
            placed: true,
            ..Default::default()
        };
        let bookings = self
            .store
            .booking_store()
            .list_bookings(&filter, limit.min(200), offset)
            .await?;
        Ok(BookingListResponse {
            items: booking_views(&self.store, bookings).await?,
        })
    }

    /// One of the customer's bookings, by id or by its code.
    pub async fn detail(&self, user_id: Uuid, id_or_code: &str) -> AppResult<BookingOut> {
        let found = match Uuid::parse_str(id_or_code) {
            Ok(id) => self.store.booking_store().find_booking_by_id(id).await?,
            Err(_) => {
                self.store
                    .booking_store()
                    .find_booking_by_code(&id_or_code.trim().to_uppercase())
                    .await?
            }
        };
        let b = found.ok_or_else(|| AppError::NotFound("booking not found".into()))?;
        if b.user_id != Some(user_id) {
            return Err(AppError::Forbidden("not your booking".into()));
        }
        booking_view(&self.store, b).await
    }

    // ── Writes ───────────────────────────────────────────────────

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

        // Where the passengers get on and off, copied onto the booking.
        let stops = trip_stops::trip_stops(&self.store, route_model.id, schedule.id).await?;
        let chosen = trip_stops::choose(&stops, req.boarding_point_id, req.dropping_point_id)?;
        let city = |slug: &str| {
            crate::cities::find_by_slug(slug).map(|c| BookingStop {
                name: c.name.to_string(),
                address: None,
                lat: Some(c.lat),
                lon: Some(c.lon),
            })
        };
        let (pickup, dropoff) = match &chosen {
            Some((on, off)) => (Some(on.snapshot()), Some(off.snapshot())),
            None => (
                city(&route_model.start_location_id),
                city(&route_model.end_location_id),
            ),
        };
        // Bookings reference route pickup points; timetable stops live on by name.
        let point_id =
            |stop: Option<&trip_stops::Stop>| stop.filter(|s| s.pickup_point).map(|s| s.id);

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

        // Pricing: each passenger pays for their seat's class, at the child
        // price when the brand sells child tickets and the age qualifies.
        let seated = seat_passengers(req, &seat_invs)?;
        let seat_rows = self
            .store
            .trip_store()
            .list_seats_by_ids(seat_uuids.clone())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let class_of: HashMap<Uuid, String> = seat_rows
            .iter()
            .map(|s| (s.id, fares::class_of(s)))
            .collect();
        let fare_table = FareTable::load(&self.store, &schedule).await?;
        let policy = brand_model.as_ref().and_then(ChildPolicy::of);
        let tickets: Vec<Ticket> = seated
            .into_iter()
            .map(|(passenger, inv)| {
                let fare = fare_table.fare(class_of.get(&inv.seat_id).map(String::as_str));
                let (kind, price) = match passenger.age {
                    Some(age) => fares::ticket(age, inv.final_price, fare, policy),
                    None => (Passenger::Adult, inv.final_price),
                };
                Ticket {
                    passenger,
                    seat_id: inv.seat_id,
                    kind,
                    price,
                }
            })
            .collect();
        let child_count = tickets
            .iter()
            .filter(|t| t.kind == Passenger::Child)
            .count() as i64;
        let adult_count = tickets.len() as i64 - child_count;
        let subtotal: i64 = tickets.iter().map(|t| t.price).sum();

        // Coupon discount: checked here, reserved as the hold's last step.
        let discount = match req.coupon_id {
            Some(coupon_id) => {
                crate::service::campaign_service::coupon_discount(
                    &self.store,
                    caller_user_id,
                    coupon_id,
                    route_model.brand_id,
                    subtotal,
                )
                .await?
            }
            None => 0,
        };

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
            boarding_point_id: Set(point_id(chosen.as_ref().map(|(on, _)| on))),
            dropping_point_id: Set(point_id(chosen.as_ref().map(|(_, off)| off))),
            pickup_name: Set(pickup.as_ref().map(|s| s.name.clone())),
            pickup_address: Set(pickup.as_ref().and_then(|s| s.address.clone())),
            pickup_lat: Set(pickup.as_ref().and_then(|s| s.lat)),
            pickup_lon: Set(pickup.as_ref().and_then(|s| s.lon)),
            dropoff_name: Set(dropoff.as_ref().map(|s| s.name.clone())),
            dropoff_address: Set(dropoff.as_ref().and_then(|s| s.address.clone())),
            dropoff_lat: Set(dropoff.as_ref().and_then(|s| s.lat)),
            dropoff_lon: Set(dropoff.as_ref().and_then(|s| s.lon)),
            adult_count: Set(adult_count),
            child_count: Set(child_count),
            subtotal: Set(subtotal),
            discount: Set(discount),
            fees: Set(fees),
            total: Set(total),
            currency: Set("VND".to_string()),
            status: Set("pending".to_string()),
            payment_method: Set(None),
            campaign_applied_id: Set(None),
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
        let bs_models: Vec<booking_seat::ActiveModel> = tickets
            .iter()
            .map(|t| booking_seat::ActiveModel {
                id: Set(Uuid::new_v4()),
                booking_id: Set(booking_id),
                seat_id: Set(t.seat_id),
                passenger_name: Set(Some(t.passenger.name.clone())),
                passenger_type: Set(Some(t.kind.as_str().into())),
                passenger_age: Set(t.passenger.age.and_then(|a| i16::try_from(a).ok())),
                price: Set(t.price),
                // `created_at` has a NOT NULL column without a DB
                // default — set it explicitly or the INSERT fails.
                created_at: Set(now_iso()),
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

        // Put the coupon on the booking. It changed since the check (used
        // on another booking, expired, given up): undo the whole hold.
        if let (Some(coupon_id), Some(owner)) = (req.coupon_id, caller_user_id) {
            let reserved = self
                .store
                .campaign_store()
                .reserve_coupon(
                    coupon_id,
                    owner,
                    booking_id,
                    route_model.brand_id,
                    &now_iso(),
                )
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            if !reserved {
                let _ = self
                    .store
                    .trip_store()
                    .release_held_seats_for_booking(&booking_id_str)
                    .await;
                let _ = self.store.booking_store().delete_booking(booking_id).await;
                return Err(AppError::Conflict(
                    crate::service::campaign_service::codes::UNAVAILABLE.into(),
                ));
            }
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

        // Build response
        let seats_json: Vec<BookingSeatOut> = tickets
            .iter()
            .map(|t| BookingSeatOut {
                seat_id: Some(t.seat_id),
                seat_code: seat_rows
                    .iter()
                    .find(|s| s.id == t.seat_id)
                    .map(|s| s.seat_label.clone()),
                seat_class: class_of.get(&t.seat_id).cloned(),
                passenger_name: Some(t.passenger.name.clone()),
                passenger_type: Some(t.kind.as_str().into()),
                passenger_age: t.passenger.age,
                price: Some(t.price),
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
            coupon_id: req.coupon_id,
        })
    }

    /// The customer cancels their booking: the seats go back on sale and
    /// any completed payment is refunded at the policy rate. Allowed while
    /// the booking is open and the trip has not left; staff see the
    /// cancellation in the admin console.
    pub async fn cancel(
        &self,
        caller_user_id: Uuid,
        id: Uuid,
        reason: Option<&str>,
    ) -> AppResult<BookingCancelResponse> {
        let b = self.owned(caller_user_id, id).await?;
        match b.status.as_str() {
            "pending" | "confirmed" => {}
            "cancelled" => return Err(AppError::BadRequest("booking already cancelled".into())),
            other => {
                return Err(AppError::BadRequest(format!(
                    "a {other} booking cannot be cancelled"
                )))
            }
        }
        let departs = departure_of(&self.store, &b).await?;
        if departs.is_some_and(|at| at <= Utc::now()) {
            return Err(AppError::BadRequest("the trip has already left".into()));
        }

        let (refund_percent, refund_amount) = self.refund_for(&b, departs).await?;

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
    async fn refund_for(
        &self,
        b: &booking::Model,
        departs: Option<chrono::DateTime<Utc>>,
    ) -> AppResult<(i64, i64)> {
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
        let percent = match departs {
            Some(at) => trip_time::refund_percent((at - Utc::now()).num_minutes() as f64 / 60.0),
            None => {
                tracing::warn!(booking = %b.id, "cancel: departure time unknown — refunding at the top tier");
                90
            }
        };
        Ok((percent, paid * percent / 100))
    }

    /// The customer chooses to pay on board. The booking is placed: its
    /// seats stay held until departure while the operator phones the
    /// customer and confirms it from the admin console.
    pub async fn place_cash(
        &self,
        caller_user_id: Uuid,
        id: Uuid,
    ) -> AppResult<BookingConfirmResponse> {
        let b = self.owned(caller_user_id, id).await?;
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
        if !self.hold_until_departure(&b, providers::COD).await? {
            return Err(AppError::Conflict(
                "booking was changed by another request".into(),
            ));
        }
        Ok(BookingConfirmResponse {
            booking_id: b.id,
            status: "pending".to_string(),
            payment_method: providers::COD.to_string(),
        })
    }

    /// Keep a pending booking's seats until its trip leaves (a pay-on-board
    /// booking waiting for the operator's call).
    pub async fn hold_until_departure(&self, b: &booking::Model, method: &str) -> AppResult<bool> {
        let until = departure_of(&self.store, b)
            .await?
            .unwrap_or_else(|| Utc::now() + chrono::Duration::days(1));
        Ok(self
            .store
            .booking_store()
            .place_pending(
                b.id,
                method,
                &until.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            )
            .await?)
    }

    /// Keep a booking's seats while its online payment is in progress: the
    /// customer needs longer than the checkout hold to finish at a gateway.
    pub async fn hold_for_payment(&self, id: Uuid, provider: &str) -> AppResult<bool> {
        Ok(self
            .store
            .booking_store()
            .place_pending(id, provider, &now_plus_iso(PAYMENT_HOLD_SECS))
            .await?)
    }

    /// Confirm after a verified payment (gateway webhook, driver collecting
    /// cash). Money has changed hands, so a hold that ran past its deadline
    /// still converts as long as nothing released the seats yet. Idempotent:
    /// a repeated notification for a booking that is already confirmed
    /// succeeds.
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

    /// A booking, if `caller` owns it.
    async fn owned(&self, caller: Uuid, id: Uuid) -> AppResult<booking::Model> {
        let b = self
            .store
            .booking_store()
            .find_booking_by_id(id)
            .await?
            .ok_or_else(|| AppError::NotFound("booking not found".into()))?;
        if b.user_id != Some(caller) {
            return Err(AppError::Forbidden("not your booking".into()));
        }
        Ok(b)
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

/// Current UTC time as ISO 8601 string.
fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Current UTC time + N seconds as ISO 8601 string.
fn now_plus_iso(secs: i64) -> String {
    (Utc::now() + chrono::Duration::seconds(secs))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// One passenger's seat on a hold, and what it costs them.
struct Ticket<'a> {
    passenger: &'a PassengerReq,
    seat_id: Uuid,
    kind: Passenger,
    price: i64,
}

/// Pairs each passenger with their seat: the seat they name when every
/// passenger names one, otherwise the seat at their position in `seatIds`.
fn seat_passengers<'a>(
    req: &'a HoldReq,
    seats: &'a [seat_inventory::Model],
) -> AppResult<Vec<(&'a PassengerReq, &'a seat_inventory::Model)>> {
    let requested: HashSet<Uuid> = req.seat_ids.iter().copied().collect();
    if requested.len() != req.seat_ids.len() {
        return Err(AppError::BadRequest("a seat is listed twice".into()));
    }
    let by_seat: HashMap<Uuid, &seat_inventory::Model> =
        seats.iter().map(|s| (s.seat_id, s)).collect();
    let named = req.passengers.iter().all(|p| p.seat_id.is_some());
    let mut taken = HashSet::new();
    req.passengers
        .iter()
        .zip(&req.seat_ids)
        .map(|(passenger, &by_position)| {
            let seat = if named {
                passenger.seat_id.unwrap_or(by_position)
            } else {
                by_position
            };
            if !requested.contains(&seat) || !taken.insert(seat) {
                return Err(AppError::BadRequest(
                    "each passenger needs a different seat from seatIds".into(),
                ));
            }
            by_seat
                .get(&seat)
                .map(|inv| (passenger, *inv))
                .ok_or_else(|| AppError::BadRequest("some seats not found or changed".into()))
        })
        .collect()
}

// ────────────────────────────────────────────────────────────────
//  Unit tests
// ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::trip_session;
    use crate::service::test_support::{fixture, hold_req, seed_trip_with_seats};
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

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

        let (trip_id, seats, stops) = seed_trip_with_seats(&store, 3).await;
        let [a, b, c] = [seats[0], seats[1], seats[2]];

        // 1) A clean two-seat hold succeeds and writes exactly one
        //    booking with two line items.
        let resp = svc.hold(None, &hold_req(trip_id, vec![a, b], stops)).await;
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
            .hold(None, &hold_req(trip_id, vec![a, b], stops))
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
            .hold(None, &hold_req(trip_id, vec![a, c], stops))
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
    async fn paying_on_board_places_the_booking_for_the_operator_to_confirm() {
        let f = fixture(2).await;
        let (owner, stranger) = (f.owner().await, f.owner().await);
        let held = f.hold(owner, 1).await;

        let err = f
            .svc
            .place_cash(stranger, held.booking_id)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Forbidden(_)), "{err:?}");

        let placed = f.svc.place_cash(owner, held.booking_id).await.unwrap();
        assert_eq!(
            (placed.status.as_str(), placed.payment_method.as_str()),
            ("pending", "cod")
        );
        // Still the customer's seat, held until the trip leaves (tomorrow),
        // well past the checkout hold; the sweep leaves it alone.
        let b = f.booking(held.booking_id).await;
        assert_eq!(b.payment_method.as_deref(), Some("cod"));
        assert!(b.expires_at.unwrap() > now_plus_iso(6 * 3600));
        f.svc.expire_stale_holds(100).await.unwrap();
        assert_eq!(f.seats_now().await, (1, 1, 0, 1));
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
        f.svc
            .confirm_as_system(held.booking_id, "vnpay")
            .await
            .unwrap();
        assert_eq!(f.seats_now().await, (0, 0, 2, 0));

        f.svc.cancel(owner, held.booking_id, None).await.unwrap();
        assert_eq!(f.seats_now().await, (2, 0, 0, 2));
    }

    #[tokio::test]
    async fn a_trip_that_has_left_cannot_be_cancelled() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        f.svc.place_cash(owner, held.booking_id).await.unwrap();
        f.depart_in(-1).await;
        let err = f
            .svc
            .cancel(owner, held.booking_id, None)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
        assert_eq!(f.booking(held.booking_id).await.status, "pending");
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
            .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[2]], f.stops))
            .await
            .unwrap();
        let paid = f
            .svc
            .hold_with_user(owner, &hold_req(f.trip, vec![f.seats[3]], f.stops))
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
            .hold_with_user(second, &hold_req(f.trip, f.seats.clone(), f.stops))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");

        f.age_hold(abandoned.booking_id, 5).await;
        f.svc.expire_stale_holds(100).await.unwrap();
        f.svc
            .hold_with_user(second, &hold_req(f.trip, f.seats.clone(), f.stops))
            .await
            .expect("the seat is on sale again");
    }

    #[tokio::test]
    async fn placing_after_the_deadline_gets_gone_and_the_seats_back() {
        let f = fixture(2).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 2).await;
        f.age_hold(held.booking_id, 5).await;

        let err = f.svc.place_cash(owner, held.booking_id).await.unwrap_err();
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
    async fn starting_a_payment_keeps_the_seats_for_it() {
        let f = fixture(1).await;
        let owner = f.owner().await;
        let held = f.hold(owner, 1).await;
        let before = f.booking(held.booking_id).await.expires_at.unwrap();

        assert!(f
            .svc
            .hold_for_payment(held.booking_id, "vnpay")
            .await
            .unwrap());
        let b = f.booking(held.booking_id).await;
        let after = b.expires_at.unwrap();
        assert!(after > before, "{before} -> {after}");
        assert_eq!(b.payment_method.as_deref(), Some("vnpay"));
        let seat = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::HeldByBookingId.eq(held.booking_id))
            .one(f.store.db())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(seat.held_until.as_deref(), Some(after.as_str()));

        f.svc.cancel(owner, held.booking_id, None).await.unwrap();
        assert!(!f
            .svc
            .hold_for_payment(held.booking_id, "vnpay")
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
            .hold_with_user(owner, &hold_req(f.trip, f.seats.clone(), f.stops))
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)), "{err:?}");
        assert_eq!(f.seats_now().await, (1, 0, 0, 1));
    }
}
