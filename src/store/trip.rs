//! Trip store — read/write access to the `trip_session`, `seat_inventory`,
//! and `seat` tables.
//!
//! Follows the template's store pattern: `TripStore` trait +
//! `DbTripStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{seat, seat_inventory, trip_session};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;
/// Parse a uuid string for a query filter BIND. The rust-sql engine
/// (sqlite dialect) stores Uuid columns as 16-byte BLOBs — binding a
/// TEXT value never matches, so every uuid filter must bind the parsed
/// `Uuid` (a BLOB parameter that does).
fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid uuid: {s}")))
}

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

    // ── Write operations ───────────────────────────────────────

    /// Find the materialized trip for a (schedule, departure-date) pair.
    /// Used by the on-demand trip generator to decide whether a trip
    /// already exists for that day.
    async fn find_trip_by_schedule_and_date(
        &self,
        schedule_id: Uuid,
        date: &str,
    ) -> StoreResult<Option<trip_session::Model>>;

    /// Insert a newly materialized trip row (the generator path).
    /// Returns the model as-inserted (the caller sets every field, so
    /// no RETURNING round-trip is needed).
    async fn insert_trip_session(
        &self,
        model: trip_session::ActiveModel,
    ) -> StoreResult<trip_session::Model>;

    /// Batch-insert seat-inventory rows for a fresh trip in one statement.
    /// Conflict-tolerant: rows whose (trip, seat) pair already exists are
    /// skipped (`ON CONFLICT DO NOTHING`), never an error. Every caller is
    /// a materializer whose contract is "ensure these seats EXIST" — a
    /// concurrent fill/repair that wrote the same rows first is success,
    /// not a conflict (see `trip_warmer` for the incident this answers).
    async fn insert_seat_inventories_batch(
        &self,
        models: Vec<seat_inventory::ActiveModel>,
    ) -> StoreResult<()>;

    async fn list_trips_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<trip_session::Model>>;
    async fn list_seat_inventories_by_held_booking(
        &self,
        booking_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>>;
    async fn update_seat_inventory(
        &self,
        model: seat_inventory::ActiveModel,
    ) -> StoreResult<seat_inventory::Model>;

    /// Bulk release — flips ALL seats held by the given booking back to
    /// 'available' in a single conditional UPDATE. Used by
    /// `booking_service::cancel`, `::confirm` (expiry-cleanup path) and
    /// `hold`'s conflict rollback. Returns the number of seats released.
    /// Idempotent — safe to call even if no seats are currently held.
    async fn release_held_seats_for_booking(&self, held_by_booking_id: &str) -> StoreResult<u64>;

    /// Bulk mark held seats as 'booked' for a given booking (the
    /// confirmation step). Single SQL UPDATE replaces the per-seat
    /// loop in `booking_service::confirm`. Returns the number of seats
    /// flipped. Idempotent — safe to call on already-booked seats.
    async fn mark_seats_booked_for_booking(&self, held_by_booking_id: &str) -> StoreResult<u64>;

    /// Bulk claim — flips ALL of `seat_ids` from 'available' → 'held' in a
    /// single conditional UPDATE (the booking `hold` step). See the impl
    /// for the TOCTOU/serialization argument.
    async fn try_hold_seats_bulk(
        &self,
        trip_session_id: &str,
        seat_ids: &[String],
        held_by_booking_id: &str,
        held_until: &str,
    ) -> StoreResult<u64>;

    /// Atomic `available_seats = available_seats - n` (one UPDATE, value
    /// derived in SQL). Replaces the read-modify-write in `hold` where two
    /// concurrent holds both read `10`, both wrote `10 - n` and one
    /// decrement was silently lost. `no_retry` matches the other
    /// seat-counter writes: the seat_inventory claim has already gated
    /// correctness — this only maintains the display/hint counter.
    async fn decrement_available_seats(&self, trip_session_id: &str, n: i64) -> StoreResult<u64>;

    async fn list_trips_by_schedule_ids(
        &self,
        schedule_ids: Vec<Uuid>,
        date: &str,
        min_seats: i64,
        limit: u64,
    ) -> StoreResult<Vec<trip_session::Model>>;
    /// A schedule's trips departing on or after `date_gte` (`YYYY-MM-DD`).
    async fn list_trips_of_schedule_from(
        &self,
        schedule_id: Uuid,
        date_gte: &str,
    ) -> StoreResult<Vec<trip_session::Model>>;

    /// Set the price of these seats on these trips while they are still
    /// for sale; held and sold seats keep the price they were sold at.
    async fn reprice_available_seats(
        &self,
        trip_ids: Vec<Uuid>,
        seat_ids: Vec<Uuid>,
        price: i64,
    ) -> StoreResult<u64>;

    /// Cheapest and dearest seat still for sale on each trip.
    async fn available_price_ranges(
        &self,
        trip_ids: Vec<Uuid>,
    ) -> StoreResult<std::collections::HashMap<Uuid, (i64, i64)>>;
    async fn list_seats_by_bus_layout_id(
        &self,
        bus_layout_id: &str,
    ) -> StoreResult<Vec<seat::Model>>;
    /// Seats of MANY layouts in one query — grouped by layout id by the
    /// caller. The batched on-demand trip generator loads every missing
    /// schedule's seats with this instead of one round-trip per layout.
    async fn list_seats_by_layout_ids(
        &self,
        bus_layout_ids: Vec<Uuid>,
    ) -> StoreResult<Vec<seat::Model>>;
    /// The schedule ids that already have a `trip_session` row on
    /// `date` — the batched existence check that replaces one
    /// `find_trip_by_schedule_and_date` round-trip per schedule.
    /// Chunked internally to bound the IN-list size.
    async fn list_trip_schedule_ids_for_date(
        &self,
        schedule_ids: Vec<Uuid>,
        date: &str,
    ) -> StoreResult<Vec<Uuid>>;
    /// Insert many trip sessions in chunked batches — the fast path of
    /// the on-demand generator (one INSERT per ~60 rows instead of one
    /// per trip).
    async fn insert_trip_sessions_batch(
        &self,
        models: Vec<trip_session::ActiveModel>,
    ) -> StoreResult<()>;
    /// All trips departing on `date`, any schedule — the warmer's
    /// repair scan (indexed by `TripSession_departureDate_idx`).
    async fn list_trips_for_date(&self, date: &str) -> StoreResult<Vec<trip_session::Model>>;
    /// Distinct trip ids that have at least one seat-inventory row
    /// (any status) — the repair scan's "is this trip complete" check.
    async fn list_trip_ids_with_seats(&self, trip_ids: Vec<Uuid>) -> StoreResult<Vec<Uuid>>;
    /// Scheduled trips departing on `date_gte` (`YYYY-MM-DD`) or later.
    async fn count_upcoming_trips(&self, date_gte: &str) -> StoreResult<u64>;
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

/// Schedules per `IN (…)` chunk in the batched existence check —
/// keeps generated SQL text and placeholder counts bounded.
const SCHEDULE_ID_CHUNK: usize = 500;

/// Trip rows per multi-row INSERT — 11 columns × 64 = 704 parameters,
/// under the classic 999-variable limit.
const TRIP_INSERT_CHUNK: usize = 64;

/// Seat-inventory rows per multi-row INSERT — same arithmetic as
/// [`TRIP_INSERT_CHUNK`].
const SEAT_INVENTORY_INSERT_CHUNK: usize = 64;

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
        // Bind uuid columns with parsed Uuid VALUES — SQLite stores
        // them as 16-byte BLOBs and TEXT binds never match.
        let tid = parse_uuid(trip_session_id)?;
        let sids: Vec<Uuid> = seat_ids
            .iter()
            .map(|s| parse_uuid(s))
            .collect::<StoreResult<Vec<_>>>()?;
        Ok(seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(tid))
            .filter(seat_inventory::Column::SeatId.is_in(sids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_seat_inventories_by_trip(
        &self,
        trip_session_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>> {
        let tid = parse_uuid(trip_session_id)?;
        Ok(seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.eq(tid))
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

    // ── Write operations ───────────────────────────────────────

    async fn find_trip_by_schedule_and_date(
        &self,
        schedule_id: Uuid,
        date: &str,
    ) -> StoreResult<Option<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::ScheduleId.eq(schedule_id))
            .filter(trip_session::Column::DepartureDate.eq(date.to_string()))
            .one(self.db.as_ref())
            .await?)
    }

    async fn insert_trip_session(
        &self,
        model: trip_session::ActiveModel,
    ) -> StoreResult<trip_session::Model> {
        // Materialize the returned Model from the ActiveModel BEFORE the
        // insert — the generator sets every field, so no RETURNING
        // round-trip is needed (the rust-sql engine's RETURNING support
        // is untested).
        let inserted: trip_session::Model = model
            .clone()
            .try_into()
            .map_err(|e| StoreError::Validation(format!("incomplete trip model: {e}")))?;
        trip_session::Entity::insert(model)
            .exec(self.db.as_ref())
            .await?;
        Ok(inserted)
    }

    #[store_macros::no_retry]
    async fn insert_seat_inventories_batch(
        &self,
        models: Vec<seat_inventory::ActiveModel>,
    ) -> StoreResult<()> {
        if models.is_empty() {
            return Ok(());
        }
        // Chunked multi-row INSERTs: 11 columns × 64 rows = 704 bound
        // parameters per statement — under the classic 999-variable
        // ceiling, so the statement shape is portable to any
        // SQLite-compatible engine. The warmer passes whole date-fills
        // here (thousands of rows); the old unchunked single statement
        // would blow the parameter limit.
        //
        // `ON CONFLICT (trip_session_id, seat_id) DO NOTHING`: the
        // 2026-10-11 production incident had the warmer's repair pass
        // abort mid-date with `UNIQUE constraint failed:
        // seat_inventory.trip_session_id, seat_inventory.seat_id` on six
        // consecutive dates — a duplicate materialization (restart
        // overlap / stale seat-existence read) made the repair re-insert
        // rows that already existed. Each aborted multi-row statement
        // rolled back inside the single-writer engine and queued every
        // reader behind it; the pool then timed out user traffic for
        // hours. Repair's semantics are "ensure present": skipping an
        // existing row is the correct outcome, so the insert is
        // conflict-tolerant by design and can never abort the batch.
        // `exec_without_returning` (like the job queue's insert): a
        // fully-skipped chunk is 0 rows affected, NOT the "None of the
        // records are inserted" error `exec` raises when it cannot
        // produce a last-insert id.
        for chunk in models.chunks(SEAT_INVENTORY_INSERT_CHUNK) {
            seat_inventory::Entity::insert_many(chunk.to_vec())
                .on_conflict(
                    OnConflict::columns([
                        seat_inventory::Column::TripSessionId,
                        seat_inventory::Column::SeatId,
                    ])
                    .do_nothing()
                    .to_owned(),
                )
                .exec_without_returning(self.db.as_ref())
                .await?;
        }
        Ok(())
    }

    async fn list_trips_for_date(&self, date: &str) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::DepartureDate.eq(date.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_trip_ids_with_seats(&self, trip_ids: Vec<Uuid>) -> StoreResult<Vec<Uuid>> {
        if trip_ids.is_empty() {
            return Ok(Vec::new());
        }
        // GROUP BY shape (same as `count_pickup_points_by_route_map`):
        // `SELECT trip_session_id, COUNT(id) … GROUP BY trip_session_id`
        // over chunked IN-lists — an index range scan per trip on
        // `SeatInventory_tripSessionId_idx`.
        use sea_orm::sea_query::Expr;
        let mut out = Vec::new();
        for chunk in trip_ids.chunks(SCHEDULE_ID_CHUNK) {
            let rows: Vec<(Uuid, i64)> = seat_inventory::Entity::find()
                .filter(seat_inventory::Column::TripSessionId.is_in(chunk.to_vec()))
                .select_only()
                .column(seat_inventory::Column::TripSessionId)
                .column_as(Expr::col(seat_inventory::Column::Id).count(), "count")
                .group_by(seat_inventory::Column::TripSessionId)
                .into_tuple::<(Uuid, i64)>()
                .all(self.db.as_ref())
                .await?;
            out.extend(rows.into_iter().map(|(id, _)| id));
        }
        Ok(out)
    }

    async fn list_trips_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_seat_inventories_by_held_booking(
        &self,
        booking_id: &str,
    ) -> StoreResult<Vec<seat_inventory::Model>> {
        let bid = parse_uuid(booking_id)?;
        Ok(seat_inventory::Entity::find()
            .filter(seat_inventory::Column::HeldByBookingId.eq(bid))
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
    async fn try_hold_seats_bulk(
        &self,
        trip_session_id: &str,
        seat_ids: &[String],
        held_by_booking_id: &str,
        held_until: &str,
    ) -> StoreResult<u64> {
        use sea_orm::sea_query::Expr;
        if seat_ids.is_empty() {
            return Ok(0);
        }
        let tid = parse_uuid(trip_session_id)?;
        let bid = parse_uuid(held_by_booking_id)?;
        let sids: Result<Vec<uuid::Uuid>, _> = seat_ids.iter().map(|s| parse_uuid(s)).collect();
        let sids = sids?;
        // One conditional UPDATE for the whole request — the
        // `status = 'available'` guard makes this safe under concurrent
        // holds: the engine serializes the UPDATE, so only one request
        // can flip a given seat from 'available' to 'held'; an overlapping
        // hold simply leaves that row unclaimed (rows_affected < seat
        // count → caller rolls back). Callers must validate duplicates
        // BEFORE calling: an IN-list with the same seat twice would claim
        // one row and report a false conflict.
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value("held"))
            .col_expr(seat_inventory::Column::HeldUntil, Expr::value(held_until))
            .col_expr(seat_inventory::Column::HeldByBookingId, Expr::value(bid))
            .filter(seat_inventory::Column::TripSessionId.eq(tid))
            .filter(seat_inventory::Column::SeatId.is_in(sids))
            .filter(seat_inventory::Column::Status.eq("available"))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    #[store_macros::no_retry]
    async fn decrement_available_seats(&self, trip_session_id: &str, n: i64) -> StoreResult<u64> {
        use sea_orm::sea_query::{BinOper, Expr};
        let tid = parse_uuid(trip_session_id)?;
        // `available_seats = available_seats - n`, computed by the engine —
        // no read-modify-write window, no lost update.
        let res = trip_session::Entity::update_many()
            .col_expr(
                trip_session::Column::AvailableSeats,
                Expr::col(trip_session::Column::AvailableSeats)
                    .binary(BinOper::Sub, Expr::value(n)),
            )
            .filter(trip_session::Column::Id.eq(tid))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    #[store_macros::no_retry]
    async fn release_held_seats_for_booking(&self, held_by_booking_id: &str) -> StoreResult<u64> {
        // Single bulk UPDATE — replaces the N-row load + N sequential
        // UPDATE pattern that previously dominated cancel/confirm latency
        // for multi-seat bookings. Conditional on `held_by_booking_id`
        // so it never releases a different booking's holds.
        use sea_orm::sea_query::Expr;
        let bid = parse_uuid(held_by_booking_id)?;
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value("available"))
            .col_expr(
                seat_inventory::Column::HeldUntil,
                Expr::value(None::<String>),
            )
            .col_expr(
                seat_inventory::Column::HeldByBookingId,
                Expr::value(None::<uuid::Uuid>),
            )
            .filter(seat_inventory::Column::HeldByBookingId.eq(bid))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    #[store_macros::no_retry]
    async fn mark_seats_booked_for_booking(&self, held_by_booking_id: &str) -> StoreResult<u64> {
        // Single bulk UPDATE — flips all seats held by this booking from
        // 'held' → 'booked'. Used by booking_service::confirm. Idempotent:
        // already-booked seats are not affected (filter is on status='held').
        use sea_orm::sea_query::Expr;
        let bid = parse_uuid(held_by_booking_id)?;
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::Status, Expr::value("booked"))
            .col_expr(
                seat_inventory::Column::HeldUntil,
                Expr::value(None::<String>),
            )
            // Keep held_by_booking_id set so we can still find the seats later
            // (e.g. for the booking detail view); just clear the held_until timestamp.
            .filter(seat_inventory::Column::HeldByBookingId.eq(bid))
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

    async fn list_trips_of_schedule_from(
        &self,
        schedule_id: Uuid,
        date_gte: &str,
    ) -> StoreResult<Vec<trip_session::Model>> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::ScheduleId.eq(schedule_id))
            .filter(trip_session::Column::DepartureDate.gte(date_gte.to_string()))
            .all(self.db.as_ref())
            .await?)
    }

    async fn reprice_available_seats(
        &self,
        trip_ids: Vec<Uuid>,
        seat_ids: Vec<Uuid>,
        price: i64,
    ) -> StoreResult<u64> {
        use sea_orm::sea_query::Expr;
        if trip_ids.is_empty() || seat_ids.is_empty() {
            return Ok(0);
        }
        let res = seat_inventory::Entity::update_many()
            .col_expr(seat_inventory::Column::BasePrice, Expr::value(price))
            .col_expr(seat_inventory::Column::FinalPrice, Expr::value(price))
            .col_expr(
                seat_inventory::Column::UpdatedAt,
                Expr::value(super::now_iso()),
            )
            .filter(seat_inventory::Column::TripSessionId.is_in(trip_ids))
            .filter(seat_inventory::Column::SeatId.is_in(seat_ids))
            .filter(seat_inventory::Column::Status.eq("available"))
            .filter(seat_inventory::Column::FinalPrice.ne(price))
            .exec(self.db.as_ref())
            .await?;
        Ok(res.rows_affected)
    }

    async fn available_price_ranges(
        &self,
        trip_ids: Vec<Uuid>,
    ) -> StoreResult<std::collections::HashMap<Uuid, (i64, i64)>> {
        use sea_orm::sea_query::Expr;
        if trip_ids.is_empty() {
            return Ok(Default::default());
        }
        let rows: Vec<(Uuid, i64, i64)> = seat_inventory::Entity::find()
            .filter(seat_inventory::Column::TripSessionId.is_in(trip_ids))
            .filter(seat_inventory::Column::Status.eq("available"))
            .select_only()
            .column(seat_inventory::Column::TripSessionId)
            .column_as(Expr::col(seat_inventory::Column::FinalPrice).min(), "min")
            .column_as(Expr::col(seat_inventory::Column::FinalPrice).max(), "max")
            .group_by(seat_inventory::Column::TripSessionId)
            .into_tuple()
            .all(self.db.as_ref())
            .await?;
        Ok(rows
            .into_iter()
            .map(|(trip, min, max)| (trip, (min, max)))
            .collect())
    }

    async fn list_seats_by_bus_layout_id(
        &self,
        bus_layout_id: &str,
    ) -> StoreResult<Vec<seat::Model>> {
        let lid = parse_uuid(bus_layout_id)?;
        Ok(seat::Entity::find()
            .filter(seat::Column::BusLayoutId.eq(lid))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_seats_by_layout_ids(
        &self,
        bus_layout_ids: Vec<Uuid>,
    ) -> StoreResult<Vec<seat::Model>> {
        if bus_layout_ids.is_empty() {
            return Ok(Vec::new());
        }
        // Chunked IN-lists — same bounding rationale as
        // `list_trip_schedule_ids_for_date` below.
        let mut out = Vec::new();
        for chunk in bus_layout_ids.chunks(SCHEDULE_ID_CHUNK) {
            out.extend(
                seat::Entity::find()
                    .filter(seat::Column::BusLayoutId.is_in(chunk.to_vec()))
                    .all(self.db.as_ref())
                    .await?,
            );
        }
        Ok(out)
    }

    async fn list_trip_schedule_ids_for_date(
        &self,
        schedule_ids: Vec<Uuid>,
        date: &str,
    ) -> StoreResult<Vec<Uuid>> {
        if schedule_ids.is_empty() {
            return Ok(Vec::new());
        }
        // One SELECT per ≤500-schedule chunk. Entity columns (not raw
        // SQL) so `schedule_id` binds as the same 16-byte BLOB the
        // engine stores — see `parse_uuid` (TEXT binds never match).
        // The chunk bound keeps the IN-list and placeholder count well
        // inside SQL-text limits on any engine.
        let mut out = Vec::new();
        for chunk in schedule_ids.chunks(SCHEDULE_ID_CHUNK) {
            let existing = trip_session::Entity::find()
                .filter(trip_session::Column::ScheduleId.is_in(chunk.to_vec()))
                .filter(trip_session::Column::DepartureDate.eq(date.to_string()))
                .all(self.db.as_ref())
                .await?;
            out.extend(existing.into_iter().map(|t| t.schedule_id));
        }
        Ok(out)
    }

    #[store_macros::no_retry]
    async fn insert_trip_sessions_batch(
        &self,
        models: Vec<trip_session::ActiveModel>,
    ) -> StoreResult<()> {
        if models.is_empty() {
            return Ok(());
        }
        // 11 columns × 64 rows = 704 bound parameters per statement —
        // under SQLite's classic 999-variable ceiling, so the statement
        // shape is portable to any SQLite-compatible engine.
        for chunk in models.chunks(TRIP_INSERT_CHUNK) {
            trip_session::Entity::insert_many(chunk.to_vec())
                .exec(self.db.as_ref())
                .await?;
        }
        Ok(())
    }

    async fn count_upcoming_trips(&self, date_gte: &str) -> StoreResult<u64> {
        Ok(trip_session::Entity::find()
            .filter(trip_session::Column::Status.eq("scheduled"))
            .filter(trip_session::Column::DepartureDate.gte(date_gte.to_string()))
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
