//! Booking store — read/write access to the `booking` and `booking_seat` tables.
//!
//! Follows the template's store pattern: `BookingStore` trait +
//! `DbBookingStore` (`#[retry]`).

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, JoinType, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, RelationTrait,
};
use store_macros::retry;
use uuid::Uuid;

use crate::entity::{booking, booking_seat};

use super::error::{StoreError, StoreResult};
use super::retry::RetryPolicy;
/// Parse a uuid string for a query filter BIND. SQLite stores Uuid
/// columns as 16-byte BLOBs — binding a TEXT value never matches, so
/// every uuid filter must bind the parsed `Uuid` (Postgres casts
/// text->uuid implicitly, SQLite does not).
fn parse_uuid(s: &str) -> StoreResult<uuid::Uuid> {
    uuid::Uuid::parse_str(s).map_err(|_| StoreError::Validation(format!("invalid uuid: {s}")))
}

// ────────────────────────────────────────────────────────────────
//  Trait
// ────────────────────────────────────────────────────────────────

#[async_trait]
pub trait BookingStore: Send + Sync {
    // ── Booking ─────────────────────────────────────────────────

    async fn find_booking_by_id(&self, id: Uuid) -> StoreResult<Option<booking::Model>>;

    /// Batch fetch bookings by id. Used by the payment admin list to
    /// resolve booking codes without an N+1 round-trip per payment row.
    async fn find_bookings_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<booking::Model>>;

    async fn list_bookings_by_user(
        &self,
        user_id: &str,
        status: &str,
        trip_session_ids: Vec<String>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>>;

    /// List bookings for a user, filtered by status + an optional
    /// trip-departure-date range (gte / lt). Replaces the previous
    /// "load all trips departing today → filter bookings by trip_session_id IN(...)"
    /// pattern that materialised ~18k trip rows on every authenticated
    /// /bookings request after a year of operation.
    ///
    /// `date_gte` and `date_lt` are `YYYY-MM-DD` strings; either can be
    /// `None` to skip that bound.
    async fn list_bookings_by_user_with_date_filter(
        &self,
        user_id: &str,
        status: &str,
        date_gte: Option<&str>,
        date_lt: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>>;
    async fn lookup_bookings(
        &self,
        code: Option<&str>,
        phone: Option<&str>,
        limit: u64,
    ) -> StoreResult<Vec<booking::Model>>;
    async fn insert_booking(&self, model: booking::ActiveModel) -> StoreResult<()>;
    async fn update_booking(&self, model: booking::ActiveModel) -> StoreResult<booking::Model>;

    /// Count bookings matching an optional status filter. Uses `COUNT(*)`
    /// — does NOT load rows into memory.
    async fn count_bookings_by_status(&self, status: Option<&str>) -> StoreResult<u64>;

    /// List bookings matching an optional status filter, with pagination.
    /// Ordered by `created_at DESC`.
    async fn list_bookings_by_status(
        &self,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>>;

    /// List ALL bookings matching an optional status filter (no pagination).
    /// Used by stats / export which need to iterate every row. Avoid using
    /// this for list endpoints — use `list_bookings_by_status` instead.
    async fn list_all_bookings_by_status(
        &self,
        status: Option<&str>,
    ) -> StoreResult<Vec<booking::Model>>;

    // ── BookingSeat ─────────────────────────────────────────────

    async fn list_booking_seats(&self, booking_id: &str) -> StoreResult<Vec<booking_seat::Model>>;
    async fn insert_booking_seat(&self, model: booking_seat::ActiveModel) -> StoreResult<()>;

    /// Batch-insert N booking_seat rows in a single INSERT statement.
    /// Replaces the N-round-trip loop pattern in booking_service::hold.
    async fn insert_booking_seats_batch(
        &self,
        models: Vec<booking_seat::ActiveModel>,
    ) -> StoreResult<()>;
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

    async fn find_bookings_by_ids(&self, ids: Vec<Uuid>) -> StoreResult<Vec<booking::Model>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        Ok(booking::Entity::find()
            .filter(booking::Column::Id.is_in(ids))
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_bookings_by_user(
        &self,
        user_id: &str,
        status: &str,
        trip_session_ids: Vec<String>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>> {
        // Bind the user id as a Uuid VALUE: SQLite stores Uuid columns
        // as 16-byte BLOBs and a TEXT bind never matches (Postgres
        // casts text→uuid implicitly, SQLite does not).
        let uid = Uuid::parse_str(user_id)
            .map_err(|_| StoreError::Validation(format!("invalid user id: {user_id}")))?;
        let mut query = booking::Entity::find().filter(booking::Column::UserId.eq(uid));

        // Bind trip ids as parsed Uuid VALUES (SQLite BLOB columns —
        // TEXT binds never match; see entity/booking.rs).
        let trip_uuids: Vec<Uuid> = trip_session_ids
            .iter()
            .map(|s| parse_uuid(s))
            .collect::<StoreResult<Vec<_>>>()?;
        match status {
            "confirmed" | "upcoming" => {
                query = query.filter(booking::Column::Status.eq("confirmed"));
                if !trip_uuids.is_empty() {
                    query = query.filter(booking::Column::TripSessionId.is_in(trip_uuids));
                }
            }
            "completed" | "past" => {
                query = query.filter(booking::Column::Status.eq("completed"));
                if !trip_uuids.is_empty() {
                    query = query.filter(booking::Column::TripSessionId.is_in(trip_uuids));
                }
            }
            "cancelled" => {
                query = query.filter(booking::Column::Status.eq("cancelled"));
            }
            "all" => {}
            _ => {}
        }

        Ok(query
            .order_by_desc(booking::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_bookings_by_user_with_date_filter(
        &self,
        user_id: &str,
        status: &str,
        date_gte: Option<&str>,
        date_lt: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>> {
        // JOIN on trip_session to filter by departure_date in a single SQL
        // query — eliminates the previous "load all trips departing
        // today → filter bookings by trip_session_id IN (...)" pattern.
        use crate::entity::trip_session;
        let uid = Uuid::parse_str(user_id)
            .map_err(|_| StoreError::Validation(format!("invalid user id: {user_id}")))?;
        let mut query = booking::Entity::find()
            .filter(booking::Column::UserId.eq(uid))
            .join(
                JoinType::InnerJoin,
                trip_session::Relation::Booking.def().rev(),
            );

        // Status filter
        match status {
            "confirmed" | "upcoming" => {
                query = query.filter(booking::Column::Status.eq("confirmed"));
            }
            "completed" | "past" => {
                query = query.filter(booking::Column::Status.eq("completed"));
            }
            "cancelled" => {
                query = query.filter(booking::Column::Status.eq("cancelled"));
            }
            _ => {}
        }

        // Departure-date bucket filter (None = no filter)
        if let Some(gte) = date_gte {
            query = query.filter(trip_session::Column::DepartureDate.gte(gte.to_string()));
        }
        if let Some(lt) = date_lt {
            query = query.filter(trip_session::Column::DepartureDate.lt(lt.to_string()));
        }

        Ok(query
            .order_by_desc(booking::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn lookup_bookings(
        &self,
        code: Option<&str>,
        phone: Option<&str>,
        limit: u64,
    ) -> StoreResult<Vec<booking::Model>> {
        // Exact-match lookups (indexed). Avoids `LIKE '%phone%'` which
        // forces a full table scan and can't use the index.
        let mut query = booking::Entity::find();

        if let Some(c) = code {
            query = query.filter(booking::Column::Code.eq(c.to_string()));
        }
        if let Some(p) = phone {
            query = query.filter(booking::Column::ContactPhone.eq(p.to_string()));
        }

        Ok(query.limit(limit).all(self.db.as_ref()).await?)
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

    async fn count_bookings_by_status(&self, status: Option<&str>) -> StoreResult<u64> {
        let mut query = booking::Entity::find();
        if let Some(s) = status {
            query = query.filter(booking::Column::Status.eq(s.to_string()));
        }
        Ok(query.count(self.db.as_ref()).await?)
    }

    async fn list_bookings_by_status(
        &self,
        status: Option<&str>,
        limit: u64,
        offset: u64,
    ) -> StoreResult<Vec<booking::Model>> {
        let mut query = booking::Entity::find();
        if let Some(s) = status {
            query = query.filter(booking::Column::Status.eq(s.to_string()));
        }
        Ok(query
            .order_by_desc(booking::Column::CreatedAt)
            .limit(limit)
            .offset(offset)
            .all(self.db.as_ref())
            .await?)
    }

    async fn list_all_bookings_by_status(
        &self,
        status: Option<&str>,
    ) -> StoreResult<Vec<booking::Model>> {
        let mut query = booking::Entity::find();
        if let Some(s) = status {
            query = query.filter(booking::Column::Status.eq(s.to_string()));
        }
        Ok(query.all(self.db.as_ref()).await?)
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

    #[store_macros::no_retry]
    async fn insert_booking_seats_batch(
        &self,
        models: Vec<booking_seat::ActiveModel>,
    ) -> StoreResult<()> {
        if models.is_empty() {
            return Ok(());
        }
        booking_seat::Entity::insert_many(models)
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
}
