//! Booking store — read/write access to the `booking` and `booking_seat` tables.
//!
//! Follows the template's store pattern: `BookingStore` trait +
//! `DbBookingStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::{BinOper, Expr, Query, SelectStatement, SimpleExpr};
use sea_orm::{
    ColumnTrait, Condition, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::db::write::with_write;
use crate::entity::{
    booking, booking_seat, payment, route, schedule, seat_inventory, trip_session,
};
use crate::payment::statuses as payment_status;

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;
/// Parse a uuid string for a query filter BIND. The rust-sql engine
/// (sqlite dialect) stores Uuid columns as 16-byte BLOBs — binding a
/// TEXT value never matches, so every uuid filter must bind the parsed
/// `Uuid` (a BLOB parameter that does).
fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid uuid: {s}")))
}

/// What [`BookingStore::confirm_pending`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmOutcome {
    Confirmed,
    /// The booking was not pending (already confirmed, cancelled or expired).
    NotPending,
    /// Still pending, but its seats are no longer all held by it. Nothing was changed.
    SeatsLost,
}

/// The coupon a hold puts on its booking.
#[derive(Debug, Clone)]
pub struct HoldCoupon {
    pub coupon_id: Uuid,
    /// Must be the coupon's holder.
    pub user_id: Uuid,
    /// The operator the discount is charged to.
    pub brand_id: Option<Uuid>,
}

/// Everything one [`BookingStore::place_hold`] writes.
#[derive(Debug, Clone)]
pub struct NewHold {
    /// The `pending` booking; its `id` must be set.
    pub booking: booking::ActiveModel,
    pub trip_session_id: Uuid,
    /// Seats to claim, without duplicates.
    pub seat_ids: Vec<Uuid>,
    /// When the claim lapses (RFC 3339, UTC).
    pub held_until: String,
    /// One line item per seat.
    pub lines: Vec<booking_seat::ActiveModel>,
    pub coupon: Option<HoldCoupon>,
}

/// What [`BookingStore::place_hold`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldOutcome {
    Held,
    /// A seat was no longer available. Nothing was written.
    SeatsTaken,
    /// The coupon is no longer the holder's held, valid coupon. Nothing
    /// was written.
    CouponUnavailable,
}

/// The `Conflict` messages with which a hold body rolls its transaction
/// back; `place_hold` turns them into a [`HoldOutcome`].
const SEATS_TAKEN: &str = "some seats are no longer available";
const COUPON_UNAVAILABLE: &str = "the coupon is no longer available";

/// What a cancelled booking gave back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Released {
    pub trip_session_id: Uuid,
    pub seats: u64,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Which bookings a listing returns, and in what order. Every field narrows
/// it; the default matches all, newest first.
#[derive(Debug, Clone, Default)]
pub struct BookingFilter {
    pub user_id: Option<Uuid>,
    pub status: Option<String>,
    pub payment_method: Option<String>,
    /// Only tickets: bookings placed for payment or already confirmed, not
    /// checkouts left unfinished.
    pub placed: bool,
    /// Code, contact name or contact phone contains this.
    pub search: Option<String>,
    /// On trips of this brand.
    pub brand_id: Option<Uuid>,
    /// On trips of this route.
    pub route_id: Option<Uuid>,
    /// Created at or after this instant (RFC 3339, UTC, whole seconds).
    pub created_from: Option<String>,
    /// Created before this instant (RFC 3339, UTC, whole seconds).
    pub created_before: Option<String>,
    pub order: BookingOrder,
}

/// The order of a booking listing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum BookingOrder {
    #[default]
    NewestFirst,
    OldestFirst,
    TotalDesc,
    TotalAsc,
}

/// `SELECT id FROM trip_session` on the schedules `schedules` selects.
fn trips_on(schedules: SelectStatement) -> SelectStatement {
    Query::select()
        .column(trip_session::Column::Id)
        .from(trip_session::Entity)
        .and_where(trip_session::Column::ScheduleId.in_subquery(schedules))
        .to_owned()
}

/// `SELECT id FROM schedule` on the routes matching `on_route`.
fn schedules_on(on_route: SimpleExpr) -> SelectStatement {
    Query::select()
        .column(schedule::Column::Id)
        .from(schedule::Entity)
        .and_where(on_route)
        .to_owned()
}

fn filtered(f: &BookingFilter) -> sea_orm::Select<booking::Entity> {
    let mut q = booking::Entity::find();
    if let Some(uid) = f.user_id {
        q = q.filter(booking::Column::UserId.eq(uid));
    }
    if let Some(status) = &f.status {
        q = q.filter(booking::Column::Status.eq(status.clone()));
    }
    if let Some(method) = &f.payment_method {
        q = q.filter(booking::Column::PaymentMethod.eq(method.clone()));
    }
    if f.placed {
        q = q.filter(
            Condition::any()
                .add(booking::Column::PaymentMethod.is_not_null())
                .add(booking::Column::Status.is_in(["confirmed", "completed"])),
        );
    }
    if let Some(term) = f.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        q = q.filter(
            Condition::any()
                .add(booking::Column::Code.contains(term.to_uppercase()))
                .add(booking::Column::ContactName.contains(term))
                .add(booking::Column::ContactPhone.contains(term)),
        );
    }
    // Brand and route sit behind trip → schedule → route; nested `IN`s
    // keep it to one statement without joins.
    if let Some(route_id) = f.route_id {
        let schedules = schedules_on(schedule::Column::RouteId.eq(route_id));
        q = q.filter(booking::Column::TripSessionId.in_subquery(trips_on(schedules)));
    }
    if let Some(brand_id) = f.brand_id {
        let routes = Query::select()
            .column(route::Column::Id)
            .from(route::Entity)
            .and_where(route::Column::BrandId.eq(brand_id))
            .to_owned();
        let schedules = schedules_on(schedule::Column::RouteId.in_subquery(routes));
        q = q.filter(booking::Column::TripSessionId.in_subquery(trips_on(schedules)));
    }
    if let Some(from) = &f.created_from {
        q = q.filter(booking::Column::CreatedAt.gte(from.clone()));
    }
    if let Some(before) = &f.created_before {
        q = q.filter(booking::Column::CreatedAt.lt(before.clone()));
    }
    q
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait BookingStore: Send + Sync {
    // ── Booking ─────────────────────────────────────────────────

    async fn find_booking_by_id(&self, id: Uuid) -> StoreResult<Option<booking::Model>>;

    /// Find a booking by its human-facing code (e.g. "VEX-AB12CD").
    /// Codes are unique (`UNIQUE` constraint) — at most one row.
    async fn find_booking_by_code(&self, code: &str) -> StoreResult<Option<booking::Model>>;

    /// Batch fetch bookings by id. Used by the payment admin list to
    /// resolve booking codes without an N+1 round-trip per payment row.
    async fn find_bookings_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<booking::Model>>;

    /// A page of the bookings matching `filter`, in its order.
    async fn list_bookings(
        &self,
        filter: &BookingFilter,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>>;

    /// How many bookings match `filter` (`COUNT(*)`, no rows loaded).
    async fn count_bookings(&self, filter: &BookingFilter) -> StoreResult<u64>;

    /// `(created_at, status, total)` of every booking matching `filter`:
    /// what reports aggregate, without loading whole rows.
    async fn booking_facts(
        &self,
        filter: &BookingFilter,
    ) -> StoreResult<Vec<(String, String, i64)>>;

    async fn insert_booking(&self, model: booking::ActiveModel) -> StoreResult<()>;
    async fn update_booking(&self, model: booking::ActiveModel) -> StoreResult<booking::Model>;

    async fn list_booking_seats(&self, booking_id: &str) -> StoreResult<Vec<booking_seat::Model>>;
    async fn insert_booking_seat(&self, model: booking_seat::ActiveModel) -> StoreResult<()>;

    async fn update_seat_inventory_status(
        &self,
        trip_session_id: &str,
        seat_id: &str,
        status: &str,
    ) -> StoreResult<()>;
    async fn list_booking_seats_by_booking_ids(
        &self,
        booking_ids: Vec<String>,
    ) -> StoreResult<Vec<booking_seat::Model>>;

    /// Create a pending booking and take its seats (and coupon) in ONE
    /// transaction: a hold that cannot get everything leaves no row
    /// behind. Of concurrent holds on the same seat exactly one wins; the
    /// others get [`HoldOutcome::SeatsTaken`].
    async fn place_hold(&self, hold: NewHold) -> StoreResult<HoldOutcome>;

    // ── Lifecycle transitions ───────────────────────────────────
    //
    // Each is ONE transaction guarded by the booking's current state, so
    // a confirm, a cancel and the expiry sweep can race safely: exactly
    // one wins and the others change nothing.

    /// `pending` → `confirmed` and the booking's held seats → `booked`.
    /// Nothing changes unless the booking is pending AND still holds all
    /// of its seats.
    async fn confirm_pending(
        &self,
        booking_id: Uuid,
        payment_method: &str,
    ) -> StoreResult<ConfirmOutcome>;

    /// Cancel a booking whose status is one of `from`: free its seats,
    /// return them to the trip's counter, give a pending booking's promo
    /// use back and cancel its pending payments. `None` = nothing to do.
    async fn cancel_booking(
        &self,
        booking_id: Uuid,
        from: &[&str],
    ) -> StoreResult<Option<Released>>;

    /// Pending bookings whose hold ran out before `now` (RFC 3339, UTC),
    /// oldest first.
    async fn list_expired_pending(&self, now: &str, limit: u64)
        -> StoreResult<Vec<booking::Model>>;

    /// Like [`cancel_booking`](Self::cancel_booking) for a pending booking,
    /// but only if its hold is still expired at `now` (a payment may have
    /// extended it since it was listed).
    async fn expire_pending(&self, booking_id: Uuid, now: &str) -> StoreResult<Option<Released>>;

    /// Record how a pending booking will be paid and hold its seats until
    /// `hold_until` (RFC 3339, UTC). `false` when it is no longer pending.
    async fn place_pending(
        &self,
        booking_id: Uuid,
        payment_method: &str,
        hold_until: &str,
    ) -> StoreResult<bool>;

    /// `confirmed` → `completed`. `false` when it was not confirmed.
    async fn complete_booking(&self, booking_id: Uuid) -> StoreResult<bool>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbBookingStore {
    db: Arc<DatabaseConnection>,
}

impl DbBookingStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbBookingStore {}

#[async_trait]
#[retry]
impl BookingStore for DbBookingStore {
    async fn find_booking_by_id(&self, id: Uuid) -> StoreResult<Option<booking::Model>> {
        Ok(booking::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_booking_by_code(&self, code: &str) -> StoreResult<Option<booking::Model>> {
        Ok(booking::Entity::find()
            .filter(booking::Column::Code.eq(code))
            .one(self.db.as_ref())
            .await?)
    }

    async fn find_bookings_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<booking::Model>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(booking::Entity::find()
            .filter(booking::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_bookings(
        &self,
        filter: &BookingFilter,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>> {
        let q = filtered(filter);
        let q = match filter.order {
            BookingOrder::NewestFirst => q.order_by_desc(booking::Column::CreatedAt),
            BookingOrder::OldestFirst => q.order_by_asc(booking::Column::CreatedAt),
            BookingOrder::TotalDesc => q.order_by_desc(booking::Column::Total),
            BookingOrder::TotalAsc => q.order_by_asc(booking::Column::Total),
        };
        Ok(q.limit(limit).offset(offset).all(self.db.as_ref()).await?)
    }

    async fn count_bookings(&self, filter: &BookingFilter) -> StoreResult<u64> {
        Ok(filtered(filter).count(self.db.as_ref()).await?)
    }

    async fn booking_facts(
        &self,
        filter: &BookingFilter,
    ) -> StoreResult<Vec<(String, String, i64)>> {
        Ok(filtered(filter)
            .select_only()
            .column(booking::Column::CreatedAt)
            .column(booking::Column::Status)
            .column(booking::Column::Total)
            .into_tuple()
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_booking(&self, model: booking::ActiveModel) -> StoreResult<()> {
        booking::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_booking(&self, model: booking::ActiveModel) -> StoreResult<booking::Model> {
        Ok(booking::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn list_booking_seats(&self, booking_id: &str) -> StoreResult<Vec<booking_seat::Model>> {
        Ok(booking_seat::Entity::find()
            .filter(booking_seat::Column::BookingId.eq(parse_uuid(booking_id)?))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn insert_booking_seat(&self, model: booking_seat::ActiveModel) -> StoreResult<()> {
        booking_seat::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    async fn update_seat_inventory_status(
        &self,
        trip_session_id: &str,
        seat_id: &str,
        status: &str,
    ) -> StoreResult<()> {
        // Atomic conditional UPDATE — only updates the seat if it exists.
        // This avoids the read-then-write TOCTOU race of the previous
        // implementation (which loaded the row, then wrote it back).
        use crate::entity::seat_inventory;
        use sea_orm::sea_query::Expr;
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value(status))
            .filter(seat_inventory::Column::TripSessionId.eq(parse_uuid(trip_session_id)?))
            .filter(seat_inventory::Column::SeatId.eq(parse_uuid(seat_id)?))
            .exec(self.db.as_ref())
            .await?;
        if res.rows_affected == 0 {
            return Err(StoreError::NotFound(format!("seat inventory {seat_id}")));
        }
        Ok(())
    }

    async fn list_booking_seats_by_booking_ids(
        &self,
        booking_ids: Vec<String>,
    ) -> StoreResult<Vec<booking_seat::Model>> {
        let ids: Vec<Uuid> = booking_ids
            .iter()
            .map(|s| parse_uuid(s))
            .collect::<StoreResult<Vec<_>>>()?;
        Ok(booking_seat::Entity::find()
            .filter(booking_seat::Column::BookingId.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn place_hold(&self, hold: NewHold) -> StoreResult<HoldOutcome> {
        let hold = Arc::new(hold);
        let held = with_write(&self.db, |txn| {
            let hold = hold.clone();
            Box::pin(async move {
                let booking_id =
                    *hold.booking.id.try_as_ref().ok_or_else(|| {
                        StoreError::Validation("a new booking needs its id".into())
                    })?;
                // The seats' `held_by_booking_id` references the booking, so
                // it goes in first; a failed hold rolls it back with the rest.
                booking::Entity::insert(hold.booking.clone())
                    .exec_without_returning(txn)
                    .await?;
                // One conditional UPDATE claims every seat. A concurrent hold
                // that committed first made a seat unavailable (this
                // transaction then re-runs and finds it so); a seat claimed
                // in the meantime fails this commit instead.
                let claimed = seat_inventory::Entity::update_many()
                    .col_expr(seat_inventory::Column::Status, Expr::value("held"))
                    .col_expr(
                        seat_inventory::Column::HeldUntil,
                        Expr::value(hold.held_until.as_str()),
                    )
                    .col_expr(
                        seat_inventory::Column::HeldByBookingId,
                        Expr::value(booking_id),
                    )
                    .filter(seat_inventory::Column::TripSessionId.eq(hold.trip_session_id))
                    .filter(seat_inventory::Column::SeatId.is_in(hold.seat_ids.clone()))
                    .filter(seat_inventory::Column::Status.eq("available"))
                    .exec(txn)
                    .await?
                    .rows_affected;
                if claimed != hold.seat_ids.len() as u64 {
                    return Err(StoreError::Conflict(SEATS_TAKEN.into()));
                }
                booking_seat::Entity::insert_many(hold.lines.clone())
                    .exec_without_returning(txn)
                    .await?;
                if let Some(coupon) = &hold.coupon {
                    let reserved = super::campaigns::reserve_booking_coupon(
                        txn,
                        coupon.coupon_id,
                        coupon.user_id,
                        booking_id,
                        coupon.brand_id,
                        &now_iso(),
                    )
                    .await?;
                    if !reserved {
                        return Err(StoreError::Conflict(COUPON_UNAVAILABLE.into()));
                    }
                }
                Ok(())
            })
        })
        .await;
        match held {
            Ok(()) => Ok(HoldOutcome::Held),
            Err(StoreError::Conflict(why)) if why == SEATS_TAKEN => Ok(HoldOutcome::SeatsTaken),
            Err(StoreError::Conflict(why)) if why == COUPON_UNAVAILABLE => {
                Ok(HoldOutcome::CouponUnavailable)
            }
            Err(e) => Err(e),
        }
    }

    #[store_macros::no_retry]
    async fn confirm_pending(
        &self,
        booking_id: Uuid,
        payment_method: &str,
    ) -> StoreResult<ConfirmOutcome> {
        let method = payment_method.to_string();
        let res = with_write(&self.db, |txn| {
            let method = method.clone();
            Box::pin(async move {
                let Some(b) = booking::Entity::find_by_id(booking_id).one(txn).await? else {
                    return Ok(ConfirmOutcome::NotPending);
                };
                if b.status != "pending" {
                    return Ok(ConfirmOutcome::NotPending);
                }
                let wanted = booking_seat::Entity::find()
                    .filter(booking_seat::Column::BookingId.eq(booking_id))
                    .count(txn)
                    .await?;
                let held = seat_inventory::Entity::find()
                    .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id))
                    .filter(seat_inventory::Column::Status.eq("held"))
                    .count(txn)
                    .await?;
                if wanted == 0 || held != wanted {
                    return Ok(ConfirmOutcome::SeatsLost);
                }

                let booked = seat_inventory::Entity::update_many()
                    .col_expr(seat_inventory::Column::Status, Expr::value("booked"))
                    .col_expr(
                        seat_inventory::Column::HeldUntil,
                        Expr::value(None::<String>),
                    )
                    .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id))
                    .filter(seat_inventory::Column::Status.eq("held"))
                    .exec(txn)
                    .await?
                    .rows_affected;
                let confirmed = booking::Entity::update_many()
                    .col_expr(booking::Column::Status, Expr::value("confirmed"))
                    .col_expr(booking::Column::PaymentMethod, Expr::value(Some(method)))
                    .col_expr(booking::Column::UpdatedAt, Expr::value(now_iso()))
                    .filter(booking::Column::Id.eq(booking_id))
                    .filter(booking::Column::Status.eq("pending"))
                    .exec(txn)
                    .await?
                    .rows_affected;
                if booked != wanted || confirmed != 1 {
                    // Lost a race between the checks and the writes: roll everything back.
                    return Err(StoreError::Conflict(
                        "booking changed during confirm".into(),
                    ));
                }
                Ok(ConfirmOutcome::Confirmed)
            })
        })
        .await;
        match res {
            Err(StoreError::Conflict(_)) => Ok(ConfirmOutcome::SeatsLost),
            other => other,
        }
    }

    #[store_macros::no_retry]
    async fn cancel_booking(
        &self,
        booking_id: Uuid,
        from: &[&str],
    ) -> StoreResult<Option<Released>> {
        let from: Vec<String> = from.iter().map(|s| s.to_string()).collect();
        self.release_booking(booking_id, from, None).await
    }

    async fn list_expired_pending(
        &self,
        now: &str,
        limit: u64,
    ) -> StoreResult<Vec<booking::Model>> {
        Ok(booking::Entity::find()
            .filter(booking::Column::Status.eq("pending"))
            .filter(booking::Column::ExpiresAt.lt(now.to_string()))
            .order_by_asc(booking::Column::ExpiresAt)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn expire_pending(&self, booking_id: Uuid, now: &str) -> StoreResult<Option<Released>> {
        self.release_booking(booking_id, vec!["pending".into()], Some(now.to_string()))
            .await
    }

    #[store_macros::no_retry]
    async fn place_pending(
        &self,
        booking_id: Uuid,
        payment_method: &str,
        hold_until: &str,
    ) -> StoreResult<bool> {
        let (method, until) = (payment_method.to_string(), hold_until.to_string());
        with_write(&self.db, |txn| {
            let (method, until) = (method.clone(), until.clone());
            Box::pin(async move {
                let placed = booking::Entity::update_many()
                    .col_expr(booking::Column::PaymentMethod, Expr::value(Some(method)))
                    .col_expr(booking::Column::ExpiresAt, Expr::value(Some(until.clone())))
                    .col_expr(booking::Column::UpdatedAt, Expr::value(now_iso()))
                    .filter(booking::Column::Id.eq(booking_id))
                    .filter(booking::Column::Status.eq("pending"))
                    .exec(txn)
                    .await?
                    .rows_affected;
                if placed == 0 {
                    return Ok(false);
                }
                seat_inventory::Entity::update_many()
                    .col_expr(seat_inventory::Column::HeldUntil, Expr::value(Some(until)))
                    .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id))
                    .filter(seat_inventory::Column::Status.eq("held"))
                    .exec(txn)
                    .await?;
                Ok(true)
            })
        })
        .await
    }

    #[store_macros::no_retry]
    async fn complete_booking(&self, booking_id: Uuid) -> StoreResult<bool> {
        with_write(&self.db, |txn| {
            Box::pin(async move {
                let now = now_iso();
                let done = booking::Entity::update_many()
                    .col_expr(booking::Column::Status, Expr::value("completed"))
                    .col_expr(booking::Column::UpdatedAt, Expr::value(now.clone()))
                    .filter(booking::Column::Id.eq(booking_id))
                    .filter(booking::Column::Status.eq("confirmed"))
                    .exec(txn)
                    .await?
                    .rows_affected;
                if done == 1 {
                    // The trip happened: its coupon becomes payable.
                    super::campaigns::redeem_booking_coupon(txn, booking_id, &now).await?;
                }
                Ok(done == 1)
            })
        })
        .await
    }
}

impl DbBookingStore {
    /// Shared body of cancel and expiry: flip the booking to `cancelled`
    /// and undo everything the hold did, in one transaction.
    async fn release_booking(
        &self,
        booking_id: Uuid,
        from: Vec<String>,
        expired_before: Option<String>,
    ) -> StoreResult<Option<Released>> {
        with_write(&self.db, |txn| {
            let (from, expired_before) = (from.clone(), expired_before.clone());
            Box::pin(async move {
                let Some(b) = booking::Entity::find_by_id(booking_id).one(txn).await? else {
                    return Ok(None);
                };
                if !from.contains(&b.status) {
                    return Ok(None);
                }
                if let Some(now) = &expired_before {
                    if b.expires_at.as_deref().is_none_or(|e| e >= now.as_str()) {
                        return Ok(None);
                    }
                }

                // Claim the transition; losing the race means someone else moved it.
                let claimed = booking::Entity::update_many()
                    .col_expr(booking::Column::Status, Expr::value("cancelled"))
                    .col_expr(booking::Column::UpdatedAt, Expr::value(now_iso()))
                    .filter(booking::Column::Id.eq(booking_id))
                    .filter(booking::Column::Status.eq(b.status.clone()))
                    .exec(txn)
                    .await?
                    .rows_affected;
                if claimed == 0 {
                    return Ok(None);
                }

                let seats = seat_inventory::Entity::update_many()
                    .col_expr(seat_inventory::Column::Status, Expr::value("available"))
                    .col_expr(
                        seat_inventory::Column::HeldUntil,
                        Expr::value(None::<String>),
                    )
                    .col_expr(
                        seat_inventory::Column::HeldByBookingId,
                        Expr::value(None::<Uuid>),
                    )
                    .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id))
                    .exec(txn)
                    .await?
                    .rows_affected;
                if seats > 0 {
                    // Counter arithmetic is done by the engine: a read-modify-write here
                    // would lose a concurrent hold's decrement.
                    trip_session::Entity::update_many()
                        .col_expr(
                            trip_session::Column::AvailableSeats,
                            Expr::col(trip_session::Column::AvailableSeats)
                                .binary(BinOper::Add, Expr::value(seats as i64)),
                        )
                        .filter(trip_session::Column::Id.eq(b.trip_session_id))
                        .exec(txn)
                        .await?;
                }

                // The trip will not happen: its coupon goes back to its owner.
                super::campaigns::return_booking_coupon(txn, booking_id, &now_iso()).await?;

                payment::Entity::update_many()
                    .col_expr(
                        payment::Column::Status,
                        Expr::value(payment_status::CANCELLED),
                    )
                    .col_expr(payment::Column::UpdatedAt, Expr::value(now_iso()))
                    .col_expr(
                        payment::Column::FailureReason,
                        Expr::value(Some("booking cancelled".to_string())),
                    )
                    .filter(payment::Column::BookingId.eq(booking_id))
                    .filter(payment::Column::Status.eq(payment_status::PENDING))
                    .exec(txn)
                    .await?;

                Ok(Some(Released {
                    trip_session_id: b.trip_session_id,
                    seats,
                }))
            })
        })
        .await
    }
}
