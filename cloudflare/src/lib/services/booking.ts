/**
 * Booking service — port of booking_service.rs to D1.
 *
 * D1 has no interactive transactions; atomicity comes from:
 *  - `db.batch([...])` (single implicit transaction per batch)
 *  - an all-or-nothing conditional bulk UPDATE for seat claims
 *    (mirrors the Rust single conditional UPDATE available→held)
 *  - compensating releases if a later batch fails
 *
 * Seat state machine: available → held → booked (→ available on release).
 * Booking statuses: pending → confirmed | cancelled.
 */
import { getDb, getD1, rawAll, rawRun, atomicBatch, sqlIn, type AtomicStatement, type Database } from "@/lib/db/client";
import {
  bookings,
  bookingSeats,
  brands,
  coupons,
  payments,
  routes,
  schedules,
  seatInventory,
  seats,
  tripSessions,
  busLayouts,
  discountTiers,
  discountCampaigns,
} from "@/lib/db/schema";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import { brandPrefix, genBookingCode, holdTtlMinutes, refundPercent } from "@/lib/format";
import { withRetry } from "@/lib/db/retry";

export interface HoldRequest {
  tripId: string;
  seatIds: string[];
  passengers: { name: string; age?: number; type?: "adult" | "child" }[];
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  boardingPointId?: string;
  droppingPointId?: string;
  couponId?: string;
}

interface TripContext {
  trip: typeof tripSessions.$inferSelect;
  schedule: typeof schedules.$inferSelect;
  route: typeof routes.$inferSelect;
  brand: typeof brands.$inferSelect | null;
}

const SELL_WINDOW_DAYS = 14;

async function loadTripContext(tripId: string): Promise<TripContext> {
  const db = await getDb();
  const rows = await withRetry(() =>
    db
      .select({ trip: tripSessions, schedule: schedules, route: routes, brand: brands })
      .from(tripSessions)
      .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
      .innerJoin(routes, eq(routes.id, schedules.routeId))
      .leftJoin(brands, eq(brands.id, routes.brandId))
      .where(eq(tripSessions.id, tripId))
      .limit(1),
  );
  const ctx = rows[0];
  if (!ctx) throw new ApiError(404, "not-found", "Trip not found");
  return ctx;
}

function seatFare(
  seatClass: string | null,
  fares: Map<string, number>,
  baseAdult: number,
): number {
  if (seatClass && fares.has(seatClass)) return fares.get(seatClass)!;
  return baseAdult;
}

function childPrice(
  adultFare: number,
  brand: typeof brands.$inferSelect | null,
  schedule: typeof schedules.$inferSelect,
): number {
  if (brand?.childDiscountAmount && brand.childDiscountAmount > 0)
    return Math.max(0, adultFare - brand.childDiscountAmount);
  if (schedule.basePriceChild != null) return schedule.basePriceChild;
  return adultFare;
}

/** Materialize seat_inventory rows for a trip from its bus layout (idempotent). */
async function ensureTripInventory(db: Database, tripId: string, scheduleId: string): Promise<void> {
  const tripRow = await db
    .select({ busLayoutId: schedules.busLayoutId, baseAdult: schedules.basePriceAdult })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);
  const layoutId = tripRow[0]?.busLayoutId;
  if (!layoutId) return;
  const fareRows = await rawAll<{ seat_class: string; price_adult: number }>(
    sql`SELECT seat_class, price_adult FROM schedule_fare WHERE schedule_id = ${scheduleId}`,
  );
  const fares = new Map<string, number>();
  for (const f of fareRows) fares.set(f.seat_class, Number(f.price_adult));

  const seatRows = await db
    .select({ id: seats.id, seatClass: seats.seatClass })
    .from(seats)
    .where(eq(seats.busLayoutId, layoutId));
  if (seatRows.length === 0) return;
  const base = Number(tripRow[0]?.baseAdult ?? 0);

  const existing = await db
    .select({ seatId: seatInventory.seatId })
    .from(seatInventory)
    .where(eq(seatInventory.tripSessionId, tripId));
  const existingSet = new Set(existing.map((e) => e.seatId));
  const missing = seatRows.filter((s) => !existingSet.has(s.id));
  if (missing.length === 0) return;

  const stmts = missing.map((s) =>
    sql`
      INSERT OR IGNORE INTO seat_inventory (id, trip_session_id, seat_id, status, base_price, final_price, currency)
      VALUES (${crypto.randomUUID()}, ${tripId}, ${s.id}, 'available', ${seatFare(s.seatClass, fares, base)}, ${seatFare(s.seatClass, fares, base)}, 'VND')
    `,
  );
  await atomicBatch(stmts);
}

/** All-or-nothing seat claim. Returns true when every seat was claimed. */
async function claimSeats(
  db: Database,
  tripId: string,
  seatIds: string[],
  bookingId: string,
  heldUntil: string,
): Promise<boolean> {
  const inList = sqlIn(seatIds);
  const result = await db.run(sql`
    UPDATE seat_inventory
    SET status = 'held',
        held_by_booking_id = ${bookingId},
        held_until = ${heldUntil},
        updated_at = ${new Date().toISOString()}
    WHERE trip_session_id = ${tripId}
      AND seat_id IN (${inList})
      AND NOT EXISTS (
        SELECT 1 FROM seat_inventory si2
        WHERE si2.trip_session_id = ${tripId}
          AND si2.seat_id IN (${inList})
          AND si2.status != 'available'
      )
  `);
  return result.meta.changes === seatIds.length;
}

async function releaseSeats(db: Database, bookingId: string): Promise<void> {
  await db.run(sql`
    UPDATE seat_inventory
    SET status = 'available', held_by_booking_id = NULL, held_until = NULL,
        updated_at = ${new Date().toISOString()}
    WHERE held_by_booking_id = ${bookingId} AND status = 'held'
  `);
}

export interface BookingResult {
  booking: typeof bookings.$inferSelect;
  seats: { seatLabel: string; seatClass: string | null; passengerName: string | null; price: number }[];
  trip: { id: string; departureDate: string; departureTime: string; routeName: string; brandName: string | null };
  couponId?: string | null;
}

export async function createBooking(userId: string, req: HoldRequest): Promise<BookingResult> {
  const db = await getDb();
  const { trip, schedule, route, brand } = await loadTripContext(req.tripId);

  // Validations (port of hold_seat checks).
  if (req.seatIds.length === 0) throw new ApiError(400, "validation", "seat_ids required");
  if (req.seatIds.length !== req.passengers.length)
    throw new ApiError(400, "validation", "passengers count must match seats");
  if (!req.contactName?.trim() || !req.contactPhone?.trim())
    throw new ApiError(400, "validation", "contact name and phone required");
  if (trip.status === "cancelled") throw new ApiError(409, "conflict", "Trip cancelled");
  const dep = new Date(`${trip.departureDate}T${schedule.departureTime}:00Z`).getTime();
  if (Date.now() >= dep) throw new ApiError(409, "conflict", "Trip already departed");
  const daysOut = (dep - Date.now()) / 86_400_000;
  if (daysOut > SELL_WINDOW_DAYS)
    throw new ApiError(400, "validation", `Only trips within ${SELL_WINDOW_DAYS} days are bookable`);

  // 1. Ensure seat inventory exists.
  await ensureTripInventory(db, trip.id, schedule.id);

  // 2. Price the seats.
  const fareRows = await rawAll<{ seat_class: string; price_adult: number }>(
    sql`SELECT seat_class, price_adult FROM schedule_fare WHERE schedule_id = ${schedule.id}`,
  );
  const fares = new Map<string, number>();
  for (const f of fareRows) fares.set(f.seat_class, Number(f.price_adult));

  const seatRows = await db
    .select({ id: seats.id, label: seats.seatLabel, seatClass: seats.seatClass })
    .from(seats)
    .where(inArray(seats.id, req.seatIds));
  const seatMap = new Map(seatRows.map((s) => [s.id, s]));
  if (seatMap.size !== req.seatIds.length)
    throw new ApiError(400, "validation", "unknown seat id in seat_ids");
  // All seats must belong to the schedule's layout.
  const layoutId = schedule.busLayoutId;
  if (layoutId) {
    const validRows = await db
      .select({ id: seats.id })
      .from(seats)
      .where(and(eq(seats.busLayoutId, layoutId), inArray(seats.id, req.seatIds)));
    if (validRows.length !== req.seatIds.length)
      throw new ApiError(400, "validation", "seats do not belong to this trip's layout");
  }

  const priced = req.seatIds.map((seatId, i) => {
    const seat = seatMap.get(seatId)!;
    const p = req.passengers[i]!;
    const adultFare = seatFare(seat.seatClass, fares, schedule.basePriceAdult);
    const isChild = p.type === "child" || (p.age != null && brand?.childMaxAge != null && p.age <= brand.childMaxAge);
    const price = isChild ? childPrice(adultFare, brand, schedule) : adultFare;
    return {
      seatId,
      seatLabel: seat.label,
      seatClass: seat.seatClass,
      passengerName: p.name,
      passengerAge: p.age ?? null,
      passengerType: isChild ? "child" : "adult",
      price,
    };
  });

  const subtotal = priced.reduce((sum, s) => sum + s.price, 0);
  const now = new Date().toISOString();
  let discount = 0;
  let couponRow: typeof coupons.$inferSelect | null = null;
  if (req.couponId) {
    couponRow = (
      await db.select().from(coupons).where(eq(coupons.id, req.couponId)).limit(1)
    )[0] ?? null;
    if (!couponRow || couponRow.userId !== userId || couponRow.status !== "held")
      throw new ApiError(400, "validation", "coupon not held by you");
    // Rust `still_valid`: the window must still be open at use time.
    if (couponRow.validUntil && couponRow.validUntil <= now)
      throw new ApiError(400, "validation", "coupon expired");
    discount = Math.min(couponRow.amount, subtotal);
  }
  const total = Math.max(0, subtotal - discount);

  // 3. Claim seats (all-or-nothing).
  const bookingId = crypto.randomUUID();
  const code = genBookingCode(brandPrefix(brand?.slug ?? route.name));
  const ttlMin = holdTtlMinutes(trip.departureDate);
  const expiresAt = new Date(Date.now() + ttlMin * 60_000).toISOString();
  const claimed = await claimSeats(db, trip.id, req.seatIds, bookingId, expiresAt);
  if (!claimed) {
    throw new ApiError(409, "conflict", "Some seats are no longer available");
  }

  // 4. Persist booking + seats + counters (single atomic batch of typed
  //    builders + the conditional raw updates that need SQL semantics).
  try {
    const stmts: AtomicStatement[] = [
      db.insert(bookings).values({
        id: bookingId,
        code,
        userId,
        tripSessionId: trip.id,
        boardingPointId: req.boardingPointId ?? null,
        droppingPointId: req.droppingPointId ?? null,
        adultCount: priced.filter((p) => p.passengerType === "adult").length,
        childCount: priced.filter((p) => p.passengerType === "child").length,
        subtotal,
        discount,
        fees: 0,
        total,
        currency: "VND",
        status: "pending",
        expiresAt,
        contactName: req.contactName,
        contactPhone: req.contactPhone,
        contactEmail: req.contactEmail ?? null,
        campaignAppliedId: couponRow?.id ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      ...priced.map((s) =>
        db.insert(bookingSeats).values({
          id: crypto.randomUUID(),
          bookingId,
          seatId: s.seatId,
          passengerName: s.passengerName,
          passengerAge: s.passengerAge,
          passengerType: s.passengerType,
          price: s.price,
          createdAt: now,
        }),
      ),
      sql`
        UPDATE trip_session SET available_seats = MAX(available_seats - ${priced.length}, 0),
             updated_at = ${now}
        WHERE id = ${trip.id}
      `,
    ];
    await atomicBatch(stmts);
    // Rust order: the booking exists, THEN the coupon is put on it. A
    // conditional no-op (raced: used elsewhere / expired / given up)
    // undoes the whole hold — no ghost pending row, no blocked seats.
    if (couponRow) {
      const reserved = await rawRun(sql`
        UPDATE coupon SET status = 'reserved', booking_id = ${bookingId},
               brand_id = ${brand?.id ?? null}, reserved_at = ${now}, updated_at = ${now}
        WHERE id = ${couponRow.id} AND status = 'held'
          AND active_holder = ${userId}
          AND (valid_until IS NULL OR valid_until > ${now})
      `);
      if ((reserved.meta.changes ?? 0) === 0) {
        await releaseSeats(db, bookingId);
        await db.delete(bookings).where(eq(bookings.id, bookingId));
        throw new ApiError(409, "conflict", "coupon-unavailable");
      }
    }
  } catch (e) {
    // Compensating release — batch failed after seats were claimed.
    await releaseSeats(db, bookingId);
    throw e;
  }

  const bookingRow = (await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0]!;
  return {
    booking: bookingRow,
    seats: priced.map((p) => ({
      seatLabel: p.seatLabel,
      seatClass: p.seatClass,
      passengerName: p.passengerName,
      price: p.price,
    })),
    trip: {
      id: trip.id,
      departureDate: trip.departureDate,
      departureTime: schedule.departureTime,
      routeName: route.name,
      brandName: brand?.name ?? null,
    },
    couponId: couponRow?.id ?? null,
  };
}

export async function getBookingForUser(
  userId: string,
  codeOrId: string,
): Promise<BookingResult | null> {
  const db = await getDb();
  const row = (
    await withRetry(() =>
      db
        .select({ booking: bookings, trip: tripSessions, schedule: schedules, route: routes, brand: brands })
        .from(bookings)
        .innerJoin(tripSessions, eq(tripSessions.id, bookings.tripSessionId))
        .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
        .innerJoin(routes, eq(routes.id, schedules.routeId))
        .leftJoin(brands, eq(brands.id, routes.brandId))
        .where(
          sql`(${bookings.id} = ${codeOrId} OR LOWER(${bookings.code}) = LOWER(${codeOrId})) AND ${bookings.userId} = ${userId}`,
        )
        .limit(1),
    )
  )[0];
  if (!row) return null;
  const seatRows = await db
    .select({ label: seats.seatLabel, seatClass: seats.seatClass, name: bookingSeats.passengerName, price: bookingSeats.price })
    .from(bookingSeats)
    .innerJoin(seats, eq(seats.id, bookingSeats.seatId))
    .where(eq(bookingSeats.bookingId, row.booking.id));
  return {
    booking: row.booking,
    seats: seatRows.map((s) => ({
      seatLabel: s.label,
      seatClass: s.seatClass,
      passengerName: s.name,
      price: Number(s.price),
    })),
    trip: {
      id: row.trip.id,
      departureDate: row.trip.departureDate,
      departureTime: row.schedule.departureTime,
      routeName: row.route.name,
      brandName: row.brand?.name ?? null,
    },
  };
}

export async function cancelBooking(userId: string, codeOrId: string): Promise<{
  status: string;
  refundPercent: number;
  refundAmount: number;
  refCode: string;
}> {
  const db = await getDb();
  const found = await getBookingForUser(userId, codeOrId);
  if (!found) throw new ApiError(404, "not-found", "Booking not found");
  const b = found.booking;
  if (b.status === "cancelled") throw new ApiError(409, "conflict", "Booking already cancelled");

  const depIso = `${found.trip.departureDate}T${found.trip.departureTime}:00Z`;
  if (b.status === "confirmed" && Date.now() > new Date(depIso).getTime())
    throw new ApiError(409, "conflict", "Cannot cancel after departure");

  const pct = b.status === "confirmed" ? refundPercent(depIso) : 0;
  const paidRows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.bookingId, b.id), eq(payments.status, "completed")));
  const refundAmount = Math.floor((pct / 100) * paidRows.reduce((s, p) => s + Number(p.amount), 0));
  const refCode = `HX-${b.code}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  const stmts: AtomicStatement[] = [
    sql`UPDATE booking SET status = 'cancelled', updated_at = ${now} WHERE id = ${b.id}`,
    sql`
      UPDATE seat_inventory SET status = 'available', held_by_booking_id = NULL, held_until = NULL, updated_at = ${now}
      WHERE trip_session_id = ${b.tripSessionId}
        AND seat_id IN (SELECT seat_id FROM booking_seat WHERE booking_id = ${b.id})
    `,
    sql`
      UPDATE trip_session SET available_seats = available_seats + ${found.seats.length}, updated_at = ${now}
      WHERE id = ${b.tripSessionId}
    `,
    sql`UPDATE payment SET status = 'cancelled', updated_at = ${now} WHERE booking_id = ${b.id} AND status = 'pending'`,
    sql`UPDATE payment SET status = 'refunded', updated_at = ${now} WHERE booking_id = ${b.id} AND status = 'completed' AND ${refundAmount} > 0`,
  ];
  if (b.campaignAppliedId) {
    // Rust `return_booking_coupon`: the coupon goes back to its owner
    // while still valid, else it expires (freeing the owner to claim
    // again).
    stmts.push(
      sql`UPDATE coupon SET status = 'held', active_holder = ${b.userId}, booking_id = NULL,
                 brand_id = NULL, reserved_at = NULL, updated_at = ${now}
            WHERE id = ${b.campaignAppliedId} AND status = 'reserved'
              AND (valid_until IS NULL OR valid_until > ${now})`,
      sql`UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
            WHERE id = ${b.campaignAppliedId} AND status = 'reserved'`,
    );
  }
  await atomicBatch(stmts);
  return { status: "cancelled", refundPercent: pct, refundAmount, refCode };
}

/** Pay-on-board: hold seats until departure instead of a short TTL. */
export async function placeBookingOnBoard(userId: string, codeOrId: string): Promise<{ expiresAt: string }> {
  const db = await getDb();
  const found = await getBookingForUser(userId, codeOrId);
  if (!found) throw new ApiError(404, "not-found", "Booking not found");
  if (found.booking.status !== "pending")
    throw new ApiError(409, "conflict", "Only pending bookings can be placed");
  const untilDeparture = `${found.trip.departureDate}T${found.trip.departureTime}:00Z`;
  const now = new Date().toISOString();
  await atomicBatch([
    sql`UPDATE booking SET expires_at = ${untilDeparture}, updated_at = ${now} WHERE id = ${found.booking.id}`,
    sql`UPDATE seat_inventory SET held_until = ${untilDeparture}, updated_at = ${now} WHERE held_by_booking_id = ${found.booking.id} AND status = 'held'`,
  ]);
  return { expiresAt: untilDeparture };
}

/** Payment completion (COD collected / verified gateway IPN): confirm booking.
 * The trip is being paid for — its coupon becomes payable to the operator
 * (`reserved → redeemed`, Rust `redeem_booking_coupon`) and the owner may
 * claim again. */
export async function completeBookingPayment(db: Database, bookingId: string): Promise<void> {
  const now = new Date().toISOString();
  await atomicBatch([
    sql`UPDATE booking SET status = 'confirmed', updated_at = ${now} WHERE id = ${bookingId} AND status = 'pending'`,
    sql`
      UPDATE seat_inventory SET status = 'booked', held_until = NULL, updated_at = ${now}
      WHERE held_by_booking_id = ${bookingId} AND status = 'held'
    `,
    sql`
      UPDATE coupon SET status = 'redeemed', active_holder = NULL, redeemed_at = ${now},
             updated_at = ${now}
      WHERE booking_id = ${bookingId} AND status = 'reserved'
    `,
  ]);
}

/** Cron: cancel expired pending bookings + free their seats (60s cadence). */
export async function sweepExpiredHolds(): Promise<{ cancelled: number }> {
  const db = await getDb();
  const now = new Date().toISOString();
  const expired = await rawAll<{ id: string; trip_session_id: string }>(
    sql`SELECT id, trip_session_id FROM booking WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ${now}`,
  );
  if (expired.length === 0) return { cancelled: 0 };
  const idList = sqlIn(expired.map((e) => e.id));
  await atomicBatch([
    sql`UPDATE booking SET status = 'cancelled', updated_at = ${now} WHERE id IN (${idList}) AND status = 'pending'`,
    sql`
      UPDATE seat_inventory SET status = 'available', held_by_booking_id = NULL, held_until = NULL, updated_at = ${now}
      WHERE held_by_booking_id IN (${idList}) AND status = 'held'
    `,
    sql`
      UPDATE trip_session SET available_seats = available_seats + (
        SELECT COUNT(*) FROM booking_seat bs JOIN booking b ON b.id = bs.booking_id
        WHERE b.id IN (${idList})
      ), updated_at = ${now}
      WHERE id IN (SELECT DISTINCT trip_session_id FROM booking WHERE id IN (${idList}))
    `,
    // Their coupons go back to the owners while still valid, else expire
    // (Rust `release_booking` → `return_booking_coupon`).
    sql`UPDATE coupon SET status = 'held', active_holder = (SELECT user_id FROM booking WHERE id = coupon.booking_id),
               booking_id = NULL, brand_id = NULL, reserved_at = NULL, updated_at = ${now}
        WHERE status = 'reserved' AND booking_id IN (${idList})
          AND (valid_until IS NULL OR valid_until > ${now})`,
    sql`UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
        WHERE status = 'reserved' AND booking_id IN (${idList})`,
  ]);
  return { cancelled: expired.length };
}

/** Cron: materialize trip_session + seat inventory for the 14-day sell window. */
export async function warmTrips(): Promise<{ created: number; pruned: number }> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + SELL_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Candidate schedule×date combos missing a trip_session.
  const candidates = await rawAll<{ schedule_id: string; date: string }>(sql`
      WITH RECURSIVE cnt(x) AS (
        SELECT 0 UNION ALL SELECT x + 1 FROM cnt WHERE x < ${SELL_WINDOW_DAYS - 1}
      )
      SELECT s.id AS schedule_id, date(${today}, '+' || cnt.x || ' days') AS date
      FROM schedule s
      JOIN route r ON r.id = s.route_id
      CROSS JOIN cnt
      WHERE r.status = 'active'
        AND date(${today}, '+' || cnt.x || ' days') BETWEEN ${today} AND ${horizon}
        AND (s.effective_from IS NULL OR s.effective_from <= date(${today}, '+' || cnt.x || ' days'))
        AND (s.effective_to IS NULL OR s.effective_to >= date(${today}, '+' || cnt.x || ' days'))
        AND (s.days_of_week IS NULL OR json_array_length(s.days_of_week) = 0
             OR EXISTS (SELECT 1 FROM json_each(s.days_of_week) je
                        WHERE CAST(je.value AS INTEGER) = CAST(strftime('%w', date(${today}, '+' || cnt.x || ' days')) AS INTEGER) + 1))
        AND NOT EXISTS (
          SELECT 1 FROM trip_session ts
          WHERE ts.schedule_id = s.id AND ts.departure_date = date(${today}, '+' || cnt.x || ' days')
        )
      LIMIT 500
    `);

  let created = 0;
  for (const c of candidates.slice(0, 200)) {
    const seatCountRows = await rawAll<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM seat se
        JOIN schedule s ON s.bus_layout_id = se.bus_layout_id
        WHERE s.id = ${c.schedule_id}
      `);
    const seatCount = Number(seatCountRows[0]?.n ?? 0);
    await db.run(sql`
      INSERT INTO trip_session (id, schedule_id, departure_date, status, total_seats, available_seats, created_at, updated_at)
      VALUES (${crypto.randomUUID()}, ${c.schedule_id}, ${c.date}, 'scheduled', ${seatCount}, ${seatCount},
              ${new Date().toISOString()}, ${new Date().toISOString()})
      ON CONFLICT(schedule_id, departure_date) DO NOTHING
    `);
    created++;
    // Materialize inventory lazily on first hold (ensureTripInventory).
  }

  // Prune departed trips' unsold inventory.
  const pruned = await db
    .run(sql`
      DELETE FROM seat_inventory
      WHERE trip_session_id IN (
        SELECT ts.id FROM trip_session ts JOIN schedule s ON s.id = ts.schedule_id
        WHERE ts.departure_date < ${today} AND ts.status = 'scheduled'
      ) AND status = 'available'
    `)
    .then((r) => r.meta.changes);

  return { created, pruned };
}
