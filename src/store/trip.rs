//! Trip store — read/write access to the `trip_session`, `seat_inventory`,
//! `seat`, and `campaign` tables.
//!
//! Follows the template's store pattern: `TripStore` trait +
//! `DbTripStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{campaign, seat, seat_inventory, trip_session};

use super::error::StoreResult;
use super::retry::RetryPolicy;

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait TripStore: Send + Sync {
    // ── TripSession ─────────────────────────────────────────────

    async fn find_trip_by_id(&self, id: Uuid) -> StoreResult<Option<trip_session::Model>>;
    async fn list_trips_departing_after(
        &self,
        date_gte: &str,
    ) -> StoreResult<Vec<trip_session::Model>>;
    async fn list_trips_departing_before(
        &self,
        date_lt: &str,
    ) -> StoreResult<Vec<trip_session::Model>>;

    // ── SeatInventory ───────────────────────────────────────────

    async fn list_seat_inventories(
        &self,
        trip_session_id: &str,
        seat_ids: Vec<String>,
    ) -> StoreResult<Vec<seat_inventory::Model>>;
    async fn list_seat_inventories_by_trip(
        &self,
        trip_session_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>>;

    // ── Seat ────────────────────────────────────────────────────

    async fn find_seat_by_id(&self, id: Uuid) -> StoreResult<Option<seat::Model>>;
    async fn list_seats_by_ids(&self, ids: Vec<String>) -> StoreResult<Vec<seat::Model>>;

    // ── Campaign ────────────────────────────────────────────────

    async fn find_active_campaign(
        &self,
        code: &str,
        now: &str,
    ) -> StoreResult<Option<campaign::Model>>;

    // ── Write operations ───────────────────────────────────────

    async fn update_trip_session(
        &self,
        model: trip_session::ActiveModel,
    ) -> StoreResult<trip_session::Model>;
    async fn update_campaign(&self, model: campaign::ActiveModel) -> StoreResult<campaign::Model>;
    async fn list_trips_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<trip_session::Model>>;
    async fn find_campaign_by_id(&self, id: Uuid) -> StoreResult<Option<campaign::Model>>;
    async fn list_seat_inventories_by_held_booking(
        &self,
        booking_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>>;
    async fn update_seat_inventory(
        &self,
        model: seat_inventory::ActiveModel,
    ) -> StoreResult<seat_inventory::Model>;

    /// Atomically claim a seat: `UPDATE seat_inventory SET status='held',
    /// held_until=?, held_by_booking_id=? WHERE trip_session_id=? AND
    /// seat_id=? AND status='available'`.
    ///
    /// Returns `Ok(true)` if the row was updated (seat claimed), or
    /// `Ok(false)` if the seat was no longer available (another request
    /// grabbed it between the read and the write). This closes the
    /// TOCTOU race in the booking `hold` flow — the read-then-write
    /// pattern in the service layer is inherently racy under concurrent
    /// holds on the same seat.
    ///
    /// Marked `#[store_macros::no_retry]` because a "false" result is a
    /// legitimate conflict, not a transient failure worth retrying.
    async fn try_hold_seat(
        &self,
        trip_session_id: &str,
        seat_id: &str,
        held_by_booking_id: &str,
        held_until: &str,
    ) -> StoreResult<bool>;

    /// Release a seat held by a specific booking back to 'available'.
    /// Conditional on `held_by_booking_id` so we never clobber a
    /// different booking's hold. Used for rollback when a multi-seat
    /// hold partially fails.
    async fn release_held_seat(
        &self,
        trip_session_id: &str,
        seat_id: &str,
        held_by_booking_id: &str,
    ) -> StoreResult<()>;

    /// Bulk version of `release_held_seat` — releases ALL seats held by
    /// the given booking in a single SQL UPDATE. Used by `booking_service::cancel`
    /// + `::confirm` (expiry-cleanup path) which previously issued N UPDATEs
    /// (one per seat) with `let _ =` swallowing any errors. Returns the
    /// number of seats released. Idempotent — safe to call even if no
    /// seats are currently held.
    async fn release_held_seats_for_booking(
        &self,
        held_by_booking_id: &str,
    ) -> StoreResult<u64>;

    /// Bulk mark held seats as 'booked' for a given booking (the
    /// confirmation step). Single SQL UPDATE replaces the per-seat
    /// loop in `booking_service::confirm`. Returns the number of seats
    /// flipped. Idempotent — safe to call on already-booked seats.
    async fn mark_seats_booked_for_booking(
        &self,
        held_by_booking_id: &str,
    ) -> StoreResult<u64>;
    async fn list_trips_by_schedule_ids(
        &self,
        schedule_ids: Vec<Uuid>,
        date: &str,
        min_seats: i64,
        limit: u64,
    ) -> StoreResult<Vec<trip_session::Model>>;
    async fn list_active_campaigns(&self, limit: u64) -> StoreResult<Vec<campaign::Model>>;
    async fn list_seats_by_bus_layout_id(
        &self,
        bus_layout_id: &str,
    ) -> StoreResult<Vec<seat::Model>>;
    async fn count_trips_by_status(&self, status: &str) -> StoreResult<u64>;
    async fn list_upcoming_trips(
        &self,
        date_gte: &str,
        limit: u64,
    ) -> StoreResult<Vec<trip_session::Model>>;
}

// ────────────────────────────────────────────────────────────────
//  DB implementation
// ────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct DbTripStore {
    db: Arc<DatabaseConnection>,
}

impl DbTripStore {
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }
}

impl RetryPolicy for DbTripStore {}

#[async_trait]
#[retry]
impl TripStore for DbTripStore {
    // ── TripSession ─────────────────────────────────────────────

    async fn find_trip_by_id(&self, id: Uuid) -> StoreResult<Option<trip_session::Model>> {
        Ok(trip_session::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_trips_departing_after(
        &self,
        date_gte: &str,
    ) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::DepartureDate.gte(date_gte))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_trips_departing_before(
        &self,
        date_lt: &str,
    ) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::DepartureDate.lt(date_lt))
            .all(self.db.as_ref())
            .await?)
    }

    // ── SeatInventory ───────────────────────────────────────────

    async fn list_seat_inventories(
        &self,
        trip_session_id: &str,
        seat_ids: Vec<String>,
    ) -> StoreResult<Vec<seat_inventory::Model>> {
        Ok(seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(trip_session_id.to_string()))
            .filter(seat_inventory::Column::SeatId.is_in(seat_ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_seat_inventories_by_trip(
        &self,
        trip_session_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>> {
        Ok(seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(trip_session_id.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    // ── Seat ────────────────────────────────────────────────────

    async fn find_seat_by_id(&self, id: Uuid) -> StoreResult<Option<seat::Model>> {
        Ok(seat::Entity::find_by_id(id).one(self.db.as_ref()).await?)
    }

    async fn list_seats_by_ids(&self, ids: Vec<String>) -> StoreResult<Vec<seat::Model>> {
        let uuids: Vec<Uuid> = ids.iter().filter_map(|s| Uuid::parse_str(s).ok()).collect();
        Ok(seat::Entity::find()
            .filter(seat::Column::Id.is_in(uuids))
            .all(self.db.as_ref())
            .await?)
    }

    // ── Campaign ────────────────────────────────────────────────

    async fn find_active_campaign(
        &self,
        code: &str,
        now: &str,
    ) -> StoreResult<Option<campaign::Model>> {
        Ok(campaign::Entity::find()
            .filter(campaign::Column::Code.eq(code.to_string()))
            .filter(campaign::Column::Status.eq("active"))
            .filter(campaign::Column::StartsAt.lte(now.to_string()))
            .filter(campaign::Column::EndsAt.gte(now.to_string()))
            .one(self.db.as_ref())
            .await?)
    }

    // ── Write operations ───────────────────────────────────────

    async fn update_trip_session(
        &self,
        model: trip_session::ActiveModel,
    ) -> StoreResult<trip_session::Model> {
        Ok(trip_session::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn update_campaign(&self, model: campaign::ActiveModel) -> StoreResult<campaign::Model> {
        Ok(campaign::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    async fn list_trips_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn find_campaign_by_id(&self, id: Uuid) -> StoreResult<Option<campaign::Model>> {
        Ok(campaign::Entity::find_by_id(id)
            .one(self.db.as_ref())
            .await?)
    }

    async fn list_seat_inventories_by_held_booking(
        &self,
        booking_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>> {
        Ok(seat_inventory::Entity::find()
            .filter(seat_inventory::Column::HeldByBookingId.eq(booking_id.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn update_seat_inventory(
        &self,
        model: seat_inventory::ActiveModel,
    ) -> StoreResult<seat_inventory::Model> {
        Ok(seat_inventory::Entity::update(model)
            .exec(self.db.as_ref())
            .await?)
    }

    #[store_macros::no_retry]
    async fn try_hold_seat(
        &self,
        trip_session_id: &str,
        seat_id: &str,
        held_by_booking_id: &str,
        held_until: &str,
    ) -> StoreResult<bool> {
        use sea_orm::sea_query::Expr;
        // Atomic conditional UPDATE — only claims the seat if it is still
        // 'available'. The `filter` on `status = 'available'` makes this
        // safe under concurrent holds: the DB serializes the UPDATEs, so
        // only one request can flip a given seat from 'available' to 'held'.
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value("held"))
            .col_expr(seat_inventory::Column::HeldUntil, Expr::value(held_until))
            .col_expr(
                seat_inventory::Column::HeldByBookingId,
                Expr::value(held_by_booking_id),
            )
            .filter(seat_inventory::Column::TripSessionId.eq(trip_session_id.to_string()))
            .filter(seat_inventory::Column::SeatId.eq(seat_id.to_string()))
            .filter(seat_inventory::Column::Status.eq("available"))
            .exec(self.db.as_ref())
            .await?;
        // `rows_affected` is 1 if we claimed the seat, 0 if it was already
        // taken by a concurrent request.
        Ok(res.rows_affected == 1)
    }

    #[store_macros::no_retry]
    async fn release_held_seat(
        &self,
        trip_session_id: &str,
        seat_id: &str,
        held_by_booking_id: &str,
    ) -> StoreResult<()> {
        use sea_orm::sea_query::Expr;
        // Conditional release — only flips back to 'available' if the
        // seat is still held by THIS booking. Prevents clobbering a
        // different booking's hold if the seat was somehow reassigned.
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
            .filter(seat_inventory::Column::TripSessionId.eq(trip_session_id.to_string()))
            .filter(seat_inventory::Column::SeatId.eq(seat_id.to_string()))
            .filter(seat_inventory::Column::HeldByBookingId.eq(held_by_booking_id.to_string()))
            .exec(self.db.as_ref())
            .await?;
        Ok(())
    }

    #[store_macros::no_retry]
    async fn release_held_seats_for_booking(
        &self,
        held_by_booking_id: &str,
    ) -> StoreResult<u64> {
        // Single bulk UPDATE — replaces the N-row load + N sequential
        // UPDATE pattern that previously dominated cancel/confirm latency
        // for multi-seat bookings. Conditional on `held_by_booking_id`
        // so it never releases a different booking's holds.
        use sea_orm::sea_query::Expr;
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value("available"))
            .col_expr(
                seat_inventory::Column::HeldUntil,
                Expr::value(None::<String>),
            )
            .col_expr(
                seat_inventory::Column::HeldByBookingId,
                Expr::value(None::<String>),
            )
            .filter(seat_inventory::Column::HeldByBookingId.eq(held_by_booking_id.to_string()))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    #[store_macros::no_retry]
    async fn mark_seats_booked_for_booking(
        &self,
        held_by_booking_id: &str,
    ) -> StoreResult<u64> {
        // Single bulk UPDATE — flips all seats held by this booking from
        // 'held' → 'booked'. Used by booking_service::confirm. Idempotent:
        // already-booked seats are not affected (filter is on status='held').
        use sea_orm::sea_query::Expr;
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value("booked"))
            .col_expr(
                seat_inventory::Column::HeldUntil,
                Expr::value(None::<String>),
            )
            // Keep held_by_booking_id set so we can still find the seats later
            // (e.g. for the booking detail view); just clear the held_until timestamp.
            .filter(seat_inventory::Column::HeldByBookingId.eq(held_by_booking_id.to_string()))
            .filter(seat_inventory::Column::Status.eq("held"))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    async fn list_trips_by_schedule_ids(
        &self,
        schedule_ids: Vec<Uuid>,
        date: &str,
        min_seats: i64,
        limit: u64,
    ) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::ScheduleId.is_in(schedule_ids))
            .filter(trip_session::Column::DepartureDate.eq(date.to_string()))
            .filter(trip_session::Column::AvailableSeats.gte(min_seats))
            .filter(trip_session::Column::Status.eq("scheduled"))
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_active_campaigns(&self, limit: u64) -> StoreResult<Vec<campaign::Model>> {
        Ok(campaign::Entity::find()
            .filter(campaign::Column::Status.eq("active"))
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_seats_by_bus_layout_id(
        &self,
        bus_layout_id: &str,
    ) -> StoreResult<Vec<seat::Model>> {
        Ok(seat::Entity::find()
            .filter(seat::Column::BusLayoutId.eq(bus_layout_id.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn count_trips_by_status(&self, status: &str) -> StoreResult<u64> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::Status.eq(status.to_string()))
            .count(self.db.as_ref())
            .await?)
    }

    async fn list_upcoming_trips(
        &self,
        date_gte: &str,
        limit: u64,
    ) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::DepartureDate.gte(date_gte.to_string()))
            .filter(trip_session::Column::AvailableSeats.gt(0))
            .filter(trip_session::Column::Status.eq("scheduled"))
            .order_by_asc(trip_session::Column::DepartureDate)
            .limit(limit)
            .all(self.db.as_ref())
            .await?)
    }
}
