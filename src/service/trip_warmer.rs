//! Trip materialization — the warm-ahead engine behind trip search.
//!
//! ## Why this module exists (the 2026-10-11 outage)
//!
//! Every search used to materialize missing trips INLINE, one schedule
//! at a time (`SELECT` existence + `INSERT` trip + `INSERT` ~40 seat
//! rows ≈ 300 ms per schedule) behind a global mutex. After a database
//! reset left the `trip_session` table empty, the first search for a
//! popular pair tried to backfill ~900 trips (~4.5 min of writes) while
//! real traffic queued behind the same mutex; requests timed out at the
//! 120 s gateway limit, users retried, and the queue never drained.
//! Search was effectively down in both city and geo modes — the backend
//! burned one full core inserting rows nobody ever got to see.
//!
//! ## The fix — three properties
//!
//! 1. **Batched writes.** One chunked existence query + multi-row
//!    `INSERT`s (≤64 rows per statement — 11 columns × 64 = 704 bound
//!    parameters, under the classic 999-variable ceiling). Backfilling
//!    900 trips is ~14 trip statements + ~560 seat statements instead of
//!    ~2700 round trips; each statement is its own implicit transaction,
//!    so the statement count is also the fsync count under
//!    `PRAGMA fullfsync`.
//! 2. **The read path only fills small gaps.** A search reads trips
//!    first, computes the missing schedules in memory (free), fills them
//!    inline under a strict wall-clock budget, and — if the fill lock is
//!    busy or the budget expires — serves whatever exists and notifies
//!    the background warmer. A search never queues behind a long write
//!    again.
//! 3. **The warmer owns the bulk work.** A boot pass + 6-hourly tick
//!    creates the trip rows of the whole sell window (today + 13 days),
//!    so the steady-state search is pure indexed reads, and prunes the
//!    unsold seats of departed trips.
//!
//! ## Trips ahead, seats on demand
//!
//! Only trip rows are created ahead: one small row per schedule and day,
//! carrying the capacity and the seats left — all search needs. A trip's
//! ~40 priced seat rows are created the first time its seat map is shown
//! or a booking holds it ([`ensure_seats`]). Creating them ahead for the
//! whole window grew the database past 650 MB for trips nobody opened.
//!
//! ## Concurrency contract
//!
//! Each [`Warmer`] owns one fill lock shared by the inline path, the
//! background task it spawns, and every service built around it — the
//! generator is check-then-insert, idempotent per `(schedule_id, date)`
//! (the `TripSession_schedule_date_uniq` unique index is the DB-side
//! backstop). The inline path uses `try_lock` and degrades to "serve
//! existing rows" instead of waiting; only the background task waits.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{Datelike, NaiveDate};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::entity::{schedule, seat, seat_inventory, vehicle_type};
use crate::error::{AppError, AppResult};
use crate::service::fares::{self, FareTable};
use crate::store::CompositeStore;

/// Days ahead (inclusive of today) that stay warm — matches what a
/// traveler can realistically book without calling the operator.
pub const SELL_WINDOW_DAYS: usize = 14;

/// Background pass cadence. Long enough that a quiescent system runs
/// no extra queries beyond the window check; short enough that a new
/// schedule becomes searchable within hours.
const WARM_INTERVAL_SECS: u64 = 6 * 3600;

/// Let boot (migrations, health gate) settle before the first pass.
const WARM_BOOT_DELAY_SECS: u64 = 5;

/// How long a search may spend filling gaps inline. Generous for a
/// batched fill of a whole city pair, tiny next to any request timeout.
pub const INLINE_FILL_BUDGET: Duration = Duration::from_secs(2);

/// Pause between dates during a window pass so the single-writer
/// engine stays available to live traffic.
const WARM_DATE_YIELD: Duration = Duration::from_millis(150);

/// Pause after every insert batch during fills. The engine serializes
/// statements behind a write-preferring RwLock: with back-to-back
/// inserts a pending writer is ALWAYS queued, and read statements
/// (searches, admin lists, worker claims) starve until the pool times
/// out — observed live on 2026-10-11, where v0.8.1's 5ms yield was not
/// enough because individual 64-row inserts on the grown
/// seat_inventory indexes hold the write lock for seconds at a time.
/// A 100ms gap gives the queued readers a full drain window between
/// statements, keeping the request path responsive for the whole
/// (multi-hour, one-time) fill.
const WARM_STATEMENT_YIELD: Duration = Duration::from_millis(100);

/// Rows per paced insert batch in the fill loops. Must not exceed the
/// store batch methods' internal chunk size semantics (64 × 11 columns
/// = 704 bound parameters).
const FILL_CHUNK: usize = 64;

/// Vietnam is UTC+7 with no daylight-saving time — a fixed offset is
/// exact year-round.
const VN_OFFSET_SECS: i64 = 7 * 3600;

/// Safety bound for `list_all_schedules` scans (prod is ~1.3k rows;
/// the previous hard-coded 1000 silently truncated it).
pub const SCHEDULE_SCAN_LIMIT: u64 = 100_000;

// ────────────────────────────────────────────────────────────────
//  Pure helpers
// ────────────────────────────────────────────────────────────────

/// Vietnam's calendar day (`YYYY-MM-DD`) for an instant.
pub fn vn_today(now: chrono::DateTime<chrono::Utc>) -> String {
    (now + chrono::Duration::seconds(VN_OFFSET_SECS))
        .format("%Y-%m-%d")
        .to_string()
}

/// `today .. today + (days - 1)`, each `YYYY-MM-DD`. Empty when `today`
/// is malformed (the caller treats that as "nothing to warm").
pub fn sell_window(today: &str, days: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(days);
    let Ok(mut d) = NaiveDate::parse_from_str(today, "%Y-%m-%d") else {
        return out;
    };
    for _ in 0..days {
        out.push(d.format("%Y-%m-%d").to_string());
        d = d.succ_opt().unwrap_or(d);
    }
    out
}

/// Does this schedule operate on `date`?
///
/// Rules (matching the admin UI semantics):
/// * `effective_from` / `effective_to` (optional `YYYY-MM-DD`) bound the
///   operating window — lexicographic compare is safe for this fixed
///   format.
/// * `days_of_week` is a 7-char `0`/`1` mask, index 0 = Monday (`T2`),
///   index 6 = Sunday (`CN`) — the same order as the admin form. `None`
///   (or a malformed mask) means DAILY, the form's default `1111111`.
pub fn schedule_runs_on(s: &schedule::Model, date: NaiveDate) -> bool {
    let d = date.format("%Y-%m-%d").to_string();
    if let Some(from) = s.effective_from.as_deref() {
        if d.as_str() < from {
            return false;
        }
    }
    if let Some(to) = s.effective_to.as_deref() {
        if d.as_str() > to {
            return false;
        }
    }
    match s.days_of_week.as_deref() {
        Some(mask) if mask.len() == 7 && mask.bytes().all(|c| c == b'0' || c == b'1') => {
            // chrono: Mon=0 … Sun=6 — exactly the mask's index order.
            let idx = date.weekday().number_from_monday() as usize - 1;
            mask.as_bytes()[idx] == b'1'
        }
        // No (valid) mask → runs every day.
        _ => true,
    }
}

// ────────────────────────────────────────────────────────────────
//  The batched materializer
// ────────────────────────────────────────────────────────────────

/// Materialize `trip_session` rows (and their seat inventories) for the
/// schedules that run on `date` and don't have a trip yet. Returns how
/// many trips were created.
///
/// Callers serialize on a [`Warmer`]'s lock — see [`Warmer::try_fill`]
/// and [`spawn`]; this function itself does not lock so the
/// inline and background paths share it without double-acquiring.
///
/// `deadline` bounds the work: the build loop stops adding trips once
/// it passes, and whatever was already built is still inserted (partial
/// progress persists; the next pass finishes the rest).
///
/// Capacity resolution (per schedule, in order):
///   1. `bus_layout_id` → the layout's `seat` rows (also produce the
///      bookable seat inventory),
///   2. `vehicle_type_id` → `vehicle_type.total_seats` (display-only
///      fallback: the trip appears in search, but has no seat map until
///      an admin attaches a layout),
///   3. otherwise the schedule is skipped (no bookable capacity).
///
/// Past dates are never filled; malformed dates are a validation error.
pub async fn materialize_missing(
    store: &CompositeStore,
    schedules: &[schedule::Model],
    date: &str,
    deadline: Option<Instant>,
) -> AppResult<usize> {
    let parsed_date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| AppError::Validation(format!("invalid date: {e}")))?;
    // Past dates are never generated. Lexicographic compare works for
    // YYYY-MM-DD.
    let today = vn_today(chrono::Utc::now());
    if date < today.as_str() {
        return Ok(0);
    }

    let running: Vec<&schedule::Model> = schedules
        .iter()
        .filter(|s| schedule_runs_on(s, parsed_date))
        .collect();
    if running.is_empty() {
        return Ok(0);
    }

    // One chunked existence query for the whole set.
    let ids: Vec<Uuid> = running.iter().map(|s| s.id).collect();
    let existing: HashSet<Uuid> = store
        .trip_store()
        .list_trip_schedule_ids_for_date(ids, date)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .into_iter()
        .collect();
    let missing: Vec<&schedule::Model> = running
        .into_iter()
        .filter(|s| !existing.contains(&s.id))
        .collect();
    if missing.is_empty() {
        return Ok(0);
    }

    // Batch context: vehicle-type capacities (layout-less schedules) and
    // every referenced layout's seats (their count is the capacity) —
    // one query each instead of per-schedule round trips.
    let vt_map: HashMap<Uuid, vehicle_type::Model> = {
        let vt_ids: Vec<Uuid> = missing
            .iter()
            .filter(|s| s.bus_layout_id.is_none())
            .filter_map(|s| s.vehicle_type_id)
            .collect();
        if vt_ids.is_empty() {
            HashMap::new()
        } else {
            store
                .vehicle_type_store()
                .find_vehicle_types_by_ids(vt_ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
                .into_iter()
                .map(|v| (v.id, v))
                .collect()
        }
    };
    let seats_by_layout: HashMap<Uuid, Vec<seat::Model>> = {
        let layout_ids: Vec<Uuid> = missing.iter().filter_map(|s| s.bus_layout_id).collect();
        if layout_ids.is_empty() {
            HashMap::new()
        } else {
            let mut m: HashMap<Uuid, Vec<seat::Model>> = HashMap::new();
            for seat in store
                .trip_store()
                .list_seats_by_layout_ids(layout_ids)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?
            {
                m.entry(seat.bus_layout_id).or_default().push(seat);
            }
            m
        }
    };

    // Build everything up front (the schedules set is bounded), then
    // insert in chunks. The deadline only guards the build loop — the
    // final chunked inserts are a handful of statements.
    let mut trip_models: Vec<crate::entity::trip_session::ActiveModel> = Vec::new();
    for s in &missing {
        if deadline.is_some_and(|dl| Instant::now() >= dl) {
            break;
        }
        let seats = s.bus_layout_id.and_then(|lid| seats_by_layout.get(&lid));
        let capacity: i64 = if let Some(seats) = seats.filter(|v| !v.is_empty()) {
            seats.len() as i64
        } else {
            s.vehicle_type_id
                .as_ref()
                .and_then(|vt| vt_map.get(vt))
                .and_then(|v| v.total_seats)
                .map(i64::from)
                .unwrap_or(0)
        };
        if capacity <= 0 {
            // No bookable capacity at all — nothing to sell.
            continue;
        }

        let now = crate::store::now_iso();
        let trip_id = Uuid::new_v4();
        trip_models.push(crate::entity::trip_session::ActiveModel {
            id: sea_orm::Set(trip_id),
            schedule_id: sea_orm::Set(s.id),
            departure_date: sea_orm::Set(date.to_string()),
            actual_departure_at: sea_orm::Set(None),
            driver_name: sea_orm::Set(None),
            driver_phone: sea_orm::Set(None),
            status: sea_orm::Set("scheduled".into()),
            total_seats: sea_orm::Set(capacity),
            available_seats: sea_orm::Set(capacity),
            created_at: sea_orm::Set(now.clone()),
            updated_at: sea_orm::Set(now),
        });
    }

    if trip_models.is_empty() {
        return Ok(0);
    }
    // Paced chunked inserts: each batch is a single multi-row statement
    // (one fsync under fullfsync), and the yield between batches keeps
    // the pool + single-writer engine available to live traffic.
    //
    // The deadline bounds the INSERT phase too, not just the build: an
    // inline fill must never run past its budget on a loaded engine.
    let mut created = 0usize;
    for chunk in trip_models.chunks(FILL_CHUNK) {
        if deadline.is_some_and(|dl| Instant::now() >= dl) {
            break;
        }
        store
            .trip_store()
            .insert_trip_sessions_batch(chunk.to_vec())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        created += chunk.len();
        tokio::time::sleep(WARM_STATEMENT_YIELD).await;
    }
    tracing::info!(created, %date, "materialized trip sessions (batched)");
    Ok(created)
}

/// Create `trip`'s seat rows if it has none yet.
///
/// Seats are not created ahead of time: a trip row (one small row per
/// schedule and day) is all search needs — it carries the capacity and
/// the seats left — while ~40 priced seat rows per trip, for every trip
/// of the sell window, made the database grow past 650 MB for trips
/// nobody opened. A trip's seats are created here the first time its
/// seat map is shown or a booking holds it, priced from the current
/// fares. Idempotent and race-safe: the insert skips seats another
/// request created meanwhile (the trip+seat unique index). Layout-less
/// schedules sell by count and have no seat rows.
pub async fn ensure_seats(
    store: &CompositeStore,
    trip: &crate::entity::trip_session::Model,
    schedule: &schedule::Model,
) -> AppResult<()> {
    let Some(layout_id) = schedule.bus_layout_id else {
        return Ok(());
    };
    let trips = store.trip_store();
    let seated = trips
        .list_trip_ids_with_seats(vec![trip.id])
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !seated.is_empty() {
        return Ok(());
    }
    let seats = trips
        .list_seats_by_layout_ids(vec![layout_id])
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if seats.is_empty() {
        return Ok(());
    }
    let fare_rows = store
        .schedule_store()
        .list_fares(vec![schedule.id])
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let fare_table = FareTable::new(schedule, &fare_rows);
    let now = crate::store::now_iso();
    let rows: Vec<seat_inventory::ActiveModel> = seats
        .iter()
        .map(|seat| {
            let price = fare_table.fare(Some(&fares::class_of(seat))).adult;
            seat_inventory::ActiveModel {
                id: sea_orm::Set(Uuid::new_v4()),
                trip_session_id: sea_orm::Set(trip.id),
                seat_id: sea_orm::Set(seat.id),
                status: sea_orm::Set("available".into()),
                base_price: sea_orm::Set(price),
                final_price: sea_orm::Set(price),
                currency: sea_orm::Set("VND".into()),
                held_until: sea_orm::Set(None),
                held_by_booking_id: sea_orm::Set(None),
                created_at: sea_orm::Set(now.clone()),
                updated_at: sea_orm::Set(now.clone()),
            }
        })
        .collect();
    for chunk in rows.chunks(FILL_CHUNK) {
        trips
            .insert_seat_inventories_batch(chunk.to_vec())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }
    Ok(())
}

/// How far back the prune looks for trips that already left. Older
/// dates were pruned by earlier passes.
const PRUNE_LOOKBACK_DAYS: i64 = 30;

/// Legacy-history backfill bounds (issue #76): the rolling prune shipped
/// 2026-10-13, but production carries trip history since 2026-09-08 —
/// every date older than the lookback keeps its unsold seat rows
/// forever unless a backfill walks them. The walk is deliberately
/// slow-and-resumable: per warmer pass (6-hourly) it processes at most
/// this many non-empty legacy dates, walking BACKWARD from the lookback
/// cutoff. ~1M stale rows drain over a few days of uptime instead of
/// one 48-minute lock-holding purge.
const BACKFILL_DATES_PER_PASS: usize = 40;

/// How far the backfill walks before giving up — one calendar year is
/// beyond any plausible booking history for this product.
const BACKFILL_MAX_DAYS: i64 = 366;

/// An empty stretch this long means there is no history that old —
/// stop the walk early (the remaining probes are empty date lookups).
const BACKFILL_EMPTY_STREAK: usize = 30;

/// Delete the unsold seat rows of trips that left before yesterday:
/// they can never be sold, and before seats were created on demand they
/// were most of the database. Sold and held seats stay (booking
/// history). Small paced statements keep the engine free for traffic.
///
/// The rolling window is followed by a bounded legacy backfill for
/// dates older than the lookback (see [`BACKFILL_DATES_PER_PASS`]).
pub async fn prune_departed_seats(store: &CompositeStore, today: &str) -> AppResult<u64> {
    let Ok(today) = NaiveDate::parse_from_str(today, "%Y-%m-%d") else {
        return Ok(0);
    };
    let mut deleted = 0u64;
    for back in 2..=PRUNE_LOOKBACK_DAYS {
        let date = (today - chrono::Duration::days(back))
            .format("%Y-%m-%d")
            .to_string();
        deleted += prune_date_seats(store, &date).await?.1;
    }
    deleted += backfill_prune_legacy_seats(store, today).await?;
    if deleted > 0 {
        tracing::info!(deleted, "pruned unsold seats of departed trips");
    }
    Ok(deleted)
}

/// One date's share of the unsold-seat prune: trips of that date, their
/// unsold seats deleted in paced chunks. Returns `(had_trips, deleted)`
/// — the backfill distinguishes "no history this old" (drives the
/// empty-streak stop) from "history already pruned" (free to skip
/// past).
async fn prune_date_seats(store: &CompositeStore, date: &str) -> AppResult<(bool, u64)> {
    let mut deleted = 0u64;
    let trips = store
        .trip_store()
        .list_trips_for_date(date)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let had_trips = !trips.is_empty();
    for chunk in trips.chunks(FILL_CHUNK) {
        let n = store
            .trip_store()
            .delete_unsold_seats_of_trips(chunk.iter().map(|t| t.id).collect())
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        deleted += n;
        if n > 0 {
            tokio::time::sleep(WARM_STATEMENT_YIELD).await;
        }
    }
    Ok((had_trips, deleted))
}

/// Walk legacy dates (older than the rolling lookback) backward,
/// bounded per pass. Resumable by design: each warmer pass picks up
/// where the last left the backlog, so restarts never lose progress
/// and no single pass holds the write path for long.
async fn backfill_prune_legacy_seats(store: &CompositeStore, today: NaiveDate) -> AppResult<u64> {
    let mut deleted = 0u64;
    let mut done = 0usize;
    let mut empty_streak = 0usize;
    for back in (PRUNE_LOOKBACK_DAYS + 1)..=(PRUNE_LOOKBACK_DAYS + BACKFILL_MAX_DAYS) {
        if done >= BACKFILL_DATES_PER_PASS || empty_streak >= BACKFILL_EMPTY_STREAK {
            break;
        }
        let date = (today - chrono::Duration::days(back))
            .format("%Y-%m-%d")
            .to_string();
        let (had_trips, n) = prune_date_seats(store, &date).await?;
        // Real work consumes the per-pass budget; history that exists
        // but is already pruned costs one cheap indexed probe and
        // neither consumes budget nor advances the empty streak.
        if had_trips {
            if n > 0 {
                done += 1;
            }
            empty_streak = 0;
        } else {
            empty_streak += 1;
        }
        deleted += n;
    }
    if deleted > 0 {
        tracing::info!(deleted, done, "legacy seat backfill: pruned a slice");
    }
    Ok(deleted)
}

// ────────────────────────────────────────────────────────────────
//  The warmer handle + background task
// ────────────────────────────────────────────────────────────────

/// Handle to the trip-materialization subsystem: the channel searches
/// notify gaps on, plus the fill lock shared by every fill path of the
/// service graph that owns it.
///
/// * [`spawn`] starts the background task (boot pass + 6-hourly
///   window pass + on-request date fills).
/// * [`Warmer::detached`] is a no-task handle for tests and embedded
///   harnesses: the lock still serializes that instance's inline fills,
///   notifications go nowhere.
pub struct Warmer {
    tx: UnboundedSender<String>,
    lock: Arc<Mutex<()>>,
}

impl Warmer {
    /// A warmer with no background task. The fill lock still works
    /// (inline fills of one service stay idempotent); `notify` sends
    /// into a closed channel and is silently dropped.
    pub fn detached() -> Self {
        let (tx, _rx) = mpsc::unbounded_channel();
        Self {
            tx,
            lock: Arc::new(Mutex::const_new(())),
        }
    }

    /// Ask the background warmer for a full pass on `date`. Fire-and-forget by design: the sender never blocks and a
    /// duplicate date is cheap — the pass is idempotent.
    pub fn notify(&self, date: &str) {
        let _ = self.tx.send(date.to_string());
    }

    /// The search path's fill: like [`materialize_missing`] but it
    /// **never waits** for the fill lock. When the background task
    /// holds it, the search serves whatever already exists — the
    /// warmer's pass will cover this date — instead of queueing behind
    /// the writer (the 2026-10-11 outage pattern).
    pub async fn try_fill(
        &self,
        store: &CompositeStore,
        schedules: &[schedule::Model],
        date: &str,
        deadline: Option<Instant>,
    ) -> AppResult<usize> {
        let Ok(_guard) = self.lock.try_lock() else {
            return Ok(0);
        };
        materialize_missing(store, schedules, date, deadline).await
    }

    /// Test seam: acquire the fill lock the way the background task's
    /// `warm_date` does. Integration tests use it to pin the "a search
    /// degrades to serving existing rows instead of queueing"
    /// contract.
    pub async fn acquire_fill_lock(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.lock.clone().lock_owned().await
    }
}

/// Spawn the background trip warmer (see [`Warmer`]).
///
/// Loop: an initial pass shortly after boot (past migrations + the
/// health gate), then every 6 hours, plus immediate passes for dates
/// received on the channel. Dropping every sender ends the task.
pub fn spawn(store: Arc<CompositeStore>) -> Warmer {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let lock: Arc<Mutex<()>> = Arc::new(Mutex::const_new(()));
    let task_lock = lock.clone();
    let task_store = store;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(WARM_BOOT_DELAY_SECS)).await;
        tracing::info!(
            window_days = SELL_WINDOW_DAYS,
            "trip warmer: initial sell-window pass"
        );
        warm_window(&task_store, &task_lock).await;

        let mut tick = tokio::time::interval(Duration::from_secs(WARM_INTERVAL_SECS));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        // Consume the interval's immediate first tick — the boot pass
        // above already ran; the next pass belongs to +6h.
        tick.tick().await;
        loop {
            // The select wakes on whichever comes first: the periodic
            // tick or a date requested by a search.
            tokio::select! {
                _ = tick.tick() => {
                    warm_window(&task_store, &task_lock).await;
                }
                date = rx.recv() => {
                    match date {
                        Some(d) => {
                            warm_date(&task_store, &task_lock, &d).await;
                            // Drain anything queued behind it.
                            while let Ok(more) = rx.try_recv() {
                                warm_date(&task_store, &task_lock, &more).await;
                            }
                        }
                        // All senders dropped — shutdown.
                        None => break,
                    }
                }
            }
        }
    });
    Warmer { tx, lock }
}

/// One date's maintenance pass: create every missing trip row. Holds
/// the fill lock so inline fills can't interleave (they degrade to
/// "serve existing" while this runs).
async fn warm_date(store: &Arc<CompositeStore>, lock: &Mutex<()>, date: &str) {
    let schedules = match store
        .schedule_store()
        .list_all_schedules(SCHEDULE_SCAN_LIMIT)
        .await
    {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(%e, %date, "trip warmer: schedule scan failed");
            return;
        }
    };
    let _guard = lock.lock().await;
    let created = match materialize_missing(store.as_ref(), &schedules, date, None).await {
        Ok(n) => n,
        Err(e) => {
            tracing::warn!(%e, %date, "trip warmer: materialize failed");
            0
        }
    };
    if created > 0 {
        tracing::info!(created, %date, "trip warmer: date filled");
    }
}

async fn warm_window(store: &Arc<CompositeStore>, lock: &Mutex<()>) {
    let today = vn_today(chrono::Utc::now());
    for date in sell_window(&today, SELL_WINDOW_DAYS) {
        warm_date(store, lock, &date).await;
        // Yield the single-writer engine to live traffic between dates.
        tokio::time::sleep(WARM_DATE_YIELD).await;
    }
    if let Err(e) = prune_departed_seats(store.as_ref(), &today).await {
        tracing::warn!(%e, "trip warmer: seat prune failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn vn_today_rolls_at_17utc() {
        let pre = chrono::Utc
            .with_ymd_and_hms(2026, 10, 11, 16, 59, 59)
            .unwrap();
        let post = chrono::Utc
            .with_ymd_and_hms(2026, 10, 11, 17, 0, 0)
            .unwrap();
        assert_eq!(vn_today(pre), "2026-10-11");
        assert_eq!(vn_today(post), "2026-10-12");
    }

    #[test]
    fn sell_window_covers_consecutive_days() {
        let w = sell_window("2026-10-11", 14);
        assert_eq!(w.len(), 14);
        assert_eq!(w[0], "2026-10-11");
        assert_eq!(w[13], "2026-10-24");
    }

    #[test]
    fn sell_window_crosses_month_boundary() {
        let w = sell_window("2026-10-20", 14);
        assert_eq!(w[11], "2026-10-31");
        assert_eq!(w[12], "2026-11-01");
        assert_eq!(w[13], "2026-11-02");
    }

    #[test]
    fn sell_window_invalid_today_is_empty() {
        assert!(sell_window("not-a-date", 14).is_empty());
        assert!(sell_window("2026-10-11", 0).is_empty());
    }

    fn sched(mask: Option<&str>, from: Option<&str>, to: Option<&str>) -> schedule::Model {
        schedule::Model {
            id: Uuid::new_v4(),
            route_id: Uuid::new_v4(),
            departure_time: "08:00".into(),
            effective_from: from.map(str::to_string),
            effective_to: to.map(str::to_string),
            days_of_week: mask.map(str::to_string),
            bus_layout_id: None,
            base_price_adult: 100_000,
            base_price_child: None,
            amenities: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            vehicle_type_id: None,
        }
    }

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn schedule_runs_on_daily_without_mask() {
        // 2026-10-12 is a Monday.
        assert!(schedule_runs_on(
            &sched(None, None, None),
            date(2026, 10, 12)
        ));
    }

    #[test]
    fn schedule_runs_on_respects_weekday_mask() {
        let monday_only = sched(Some("1000000"), None, None);
        assert!(schedule_runs_on(&monday_only, date(2026, 10, 12))); // Mon
        assert!(!schedule_runs_on(&monday_only, date(2026, 10, 13))); // Tue
        let weekend = sched(Some("0000011"), None, None);
        assert!(schedule_runs_on(&weekend, date(2026, 10, 17))); // Sat
        assert!(schedule_runs_on(&weekend, date(2026, 10, 18))); // Sun
        assert!(!schedule_runs_on(&weekend, date(2026, 10, 16))); // Fri
    }

    #[test]
    fn schedule_runs_on_malformed_mask_means_daily() {
        assert!(schedule_runs_on(
            &sched(Some("111"), None, None),
            date(2026, 10, 12)
        ));
    }

    #[test]
    fn schedule_runs_on_respects_effective_window() {
        let s = sched(None, Some("2026-10-14"), Some("2026-10-20"));
        assert!(!schedule_runs_on(&s, date(2026, 10, 13)));
        assert!(schedule_runs_on(&s, date(2026, 10, 14)));
        assert!(schedule_runs_on(&s, date(2026, 10, 20)));
        assert!(!schedule_runs_on(&s, date(2026, 10, 21)));
    }
}
