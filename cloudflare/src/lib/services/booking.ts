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
import {
  getDb,
  rawAll,
  atomicBatch,
  sqlIn,
  type AtomicStatement,
  type Database,
} from "@/lib/db/client";
import {
  bookings,
  bookingSeats,
  brands,
  coupons,
  payments,
  routes,
  scheduleFares,
  schedules,
  seatInventory,
  seats,
  tripSessions,
} from "@/lib/db/schema";
import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
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

function seatFare(seatClass: string | null, fares: Map<string, number>, baseAdult: number): number {
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
async function ensureTripInventory(
  db: Database,
  tripId: string,
  scheduleId: string,
): Promise<void> {
  const tripRow = await db
    .select({ busLayoutId: schedules.busLayoutId, baseAdult: schedules.basePriceAdult })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);
  const layoutId = tripRow[0]?.busLayoutId;
  if (!layoutId) return;
  const fareRows = await db
    .select({ seatClass: scheduleFares.seatClass, priceAdult: scheduleFares.priceAdult })
    .from(scheduleFares)
    .where(eq(scheduleFares.scheduleId, scheduleId));
  const fares = new Map<string, number>();
  for (const f of fareRows) fares.set(f.seatClass, Number(f.priceAdult));

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

  const stmts = missing.map((s) => {
    const fare = seatFare(s.seatClass, fares, base);
    return db
      .insert(seatInventory)
      .values({
        id: crypto.randomUUID(),
        tripSessionId: tripId,
        seatId: s.id,
        status: "available",
        basePrice: fare,
        finalPrice: fare,
        currency: "VND",
      })
      .onConflictDoNothing({ target: [seatInventory.tripSessionId, seatInventory.seatId] });
  });
  await atomicBatch(stmts);
}

/** All-or-nothing seat claim. Returns true when every seat was claimed.
 * The NOT EXISTS self-join makes the whole set claimable or nothing —
 * expressed with the builder + a table alias so column names stay
 * compiler-checked. */
async function claimSeats(
  db: Database,
  tripId: string,
  seatIds: string[],
  bookingId: string,
  heldUntil: string,
): Promise<boolean> {
  const si2 = alias(seatInventory, "si2");
  const result = await db
    .update(seatInventory)
    .set({
      status: "held",
      heldByBookingId: bookingId,
      heldUntil,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(seatInventory.tripSessionId, tripId),
        inArray(seatInventory.seatId, seatIds),
        notExists(
          db
            .select({ one: sql`1` })
            .from(si2)
            .where(
              and(
                eq(si2.tripSessionId, tripId),
                inArray(si2.seatId, seatIds),
                ne(si2.status, "available"),
              ),
            ),
        ),
      ),
    )
    .run();
  return result.meta.changes === seatIds.length;
}

async function releaseSeats(db: Database, bookingId: string): Promise<void> {
  await db
    .update(seatInventory)
    .set({
      status: "available",
      heldByBookingId: null,
      heldUntil: null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(seatInventory.heldByBookingId, bookingId), eq(seatInventory.status, "held")))
    .run();
}

export interface BookingResult {
  booking: typeof bookings.$inferSelect;
  seats: {
    seatLabel: string;
    seatClass: string | null;
    passengerName: string | null;
    price: number;
  }[];
  trip: {
    id: string;
    departureDate: string;
    departureTime: string;
    routeName: string;
    brandName: string | null;
  };
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
    throw new ApiError(
      400,
      "validation",
      `Only trips within ${SELL_WINDOW_DAYS} days are bookable`,
    );

  // 1. Ensure seat inventory exists.
  await ensureTripInventory(db, trip.id, schedule.id);

  // 2. Price the seats.
  const fareRows = await db
    .select({ seatClass: scheduleFares.seatClass, priceAdult: scheduleFares.priceAdult })
    .from(scheduleFares)
    .where(eq(scheduleFares.scheduleId, schedule.id));
  const fares = new Map<string, number>();
  for (const f of fareRows) fares.set(f.seatClass, Number(f.priceAdult));

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
    const p = req.passengers[i];
    const adultFare = seatFare(seat.seatClass, fares, schedule.basePriceAdult);
    const isChild =
      p.type === "child" ||
      (p.age != null && brand?.childMaxAge != null && p.age <= brand.childMaxAge);
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
    couponRow =
      (await db.select().from(coupons).where(eq(coupons.id, req.couponId)).limit(1))[0] ?? null;
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
      db
        .update(tripSessions)
        .set({
          availableSeats: sql`MAX(${tripSessions.availableSeats} - ${priced.length}, 0)`,
          updatedAt: now,
        })
        .where(eq(tripSessions.id, trip.id)),
    ];
    await atomicBatch(stmts);
    // Rust order: the booking exists, THEN the coupon is put on it. A
    // conditional no-op (raced: used elsewhere / expired / given up)
    // undoes the whole hold — no ghost pending row, no blocked seats.
    if (couponRow) {
      const reserved = await db
        .update(coupons)
        .set({
          status: "reserved",
          bookingId,
          brandId: brand?.id ?? null,
          reservedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(coupons.id, couponRow.id),
            eq(coupons.status, "held"),
            eq(coupons.activeHolder, userId),
            or(isNull(coupons.validUntil), gt(coupons.validUntil, now)),
          ),
        )
        .run();
      if (reserved.meta.changes === 0) {
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

  const bookingRow = (
    await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  )[0];
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
        .select({
          booking: bookings,
          trip: tripSessions,
          schedule: schedules,
          route: routes,
          brand: brands,
        })
        .from(bookings)
        .innerJoin(tripSessions, eq(tripSessions.id, bookings.tripSessionId))
        .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
        .innerJoin(routes, eq(routes.id, schedules.routeId))
        .leftJoin(brands, eq(brands.id, routes.brandId))
        .where(
          and(
            or(eq(bookings.id, codeOrId), sql`LOWER(${bookings.code}) = LOWER(${codeOrId})`),
            eq(bookings.userId, userId),
          ),
        )
        .limit(1),
    )
  )[0];
  if (!row) return null;
  const seatRows = await db
    .select({
      label: seats.seatLabel,
      seatClass: seats.seatClass,
      name: bookingSeats.passengerName,
      price: bookingSeats.price,
    })
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

export async function cancelBooking(
  userId: string,
  codeOrId: string,
): Promise<{
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
    db.update(bookings).set({ status: "cancelled", updatedAt: now }).where(eq(bookings.id, b.id)),
    db
      .update(seatInventory)
      .set({
        status: "available",
        heldByBookingId: null,
        heldUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(seatInventory.tripSessionId, b.tripSessionId),
          inArray(
            seatInventory.seatId,
            db
              .select({ seatId: bookingSeats.seatId })
              .from(bookingSeats)
              .where(eq(bookingSeats.bookingId, b.id)),
          ),
        ),
      ),
    db
      .update(tripSessions)
      .set({
        availableSeats: sql`${tripSessions.availableSeats} + ${found.seats.length}`,
        updatedAt: now,
      })
      .where(eq(tripSessions.id, b.tripSessionId)),
    db
      .update(payments)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(eq(payments.bookingId, b.id), eq(payments.status, "pending"))),
    // refundAmount is a known number here — decide in TypeScript, not SQL.
    ...(refundAmount > 0
      ? [
          db
            .update(payments)
            .set({ status: "refunded", updatedAt: now })
            .where(and(eq(payments.bookingId, b.id), eq(payments.status, "completed"))),
        ]
      : []),
  ];
  if (b.campaignAppliedId) {
    // Rust `return_booking_coupon`: the coupon goes back to its owner
    // while still valid, else it expires (freeing the owner to claim
    // again).
    stmts.push(
      db
        .update(coupons)
        .set({
          status: "held",
          activeHolder: b.userId,
          bookingId: null,
          brandId: null,
          reservedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(coupons.id, b.campaignAppliedId),
            eq(coupons.status, "reserved"),
            or(isNull(coupons.validUntil), gt(coupons.validUntil, now)),
          ),
        ),
      db
        .update(coupons)
        .set({ status: "expired", activeHolder: null, updatedAt: now })
        .where(and(eq(coupons.id, b.campaignAppliedId), eq(coupons.status, "reserved"))),
    );
  }
  await atomicBatch(stmts);
  return { status: "cancelled", refundPercent: pct, refundAmount, refCode };
}

/** Pay-on-board: hold seats until departure instead of a short TTL. */
export async function placeBookingOnBoard(
  userId: string,
  codeOrId: string,
): Promise<{ expiresAt: string }> {
  const db = await getDb();
  const found = await getBookingForUser(userId, codeOrId);
  if (!found) throw new ApiError(404, "not-found", "Booking not found");
  if (found.booking.status !== "pending")
    throw new ApiError(409, "conflict", "Only pending bookings can be placed");
  const untilDeparture = `${found.trip.departureDate}T${found.trip.departureTime}:00Z`;
  const now = new Date().toISOString();
  await atomicBatch([
    db
      .update(bookings)
      .set({ expiresAt: untilDeparture, updatedAt: now })
      .where(eq(bookings.id, found.booking.id)),
    db
      .update(seatInventory)
      .set({ heldUntil: untilDeparture, updatedAt: now })
      .where(
        and(eq(seatInventory.heldByBookingId, found.booking.id), eq(seatInventory.status, "held")),
      ),
  ]);
  return { expiresAt: untilDeparture };
}

/** Payment completion (COD collected / verified gateway IPN): confirm booking.
 * The trip is being paid for — its coupon becomes payable to the operator
 * (`reserved → redeemed`, Rust `redeem_booking_coupon`) and the owner may
 * claim again. */
export async function completeBookingPayment(bookingId: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await atomicBatch([
    db
      .update(bookings)
      .set({ status: "confirmed", updatedAt: now })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, "pending"))),
    db
      .update(seatInventory)
      .set({ status: "booked", heldUntil: null, updatedAt: now })
      .where(and(eq(seatInventory.heldByBookingId, bookingId), eq(seatInventory.status, "held"))),
    db
      .update(coupons)
      .set({ status: "redeemed", activeHolder: null, redeemedAt: now, updatedAt: now })
      .where(and(eq(coupons.bookingId, bookingId), eq(coupons.status, "reserved"))),
  ]);
}

/** Cron: cancel expired pending bookings + free their seats (60s cadence). */
export async function sweepExpiredHolds(): Promise<{ cancelled: number }> {
  const db = await getDb();
  const now = new Date().toISOString();
  const expired = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "pending"),
        isNotNull(bookings.expiresAt),
        lt(bookings.expiresAt, now),
      ),
    );
  if (expired.length === 0) return { cancelled: 0 };
  const ids = expired.map((e) => e.id);
  await atomicBatch([
    db
      .update(bookings)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(inArray(bookings.id, ids), eq(bookings.status, "pending"))),
    db
      .update(seatInventory)
      .set({
        status: "available",
        heldByBookingId: null,
        heldUntil: null,
        updatedAt: now,
      })
      .where(and(inArray(seatInventory.heldByBookingId, ids), eq(seatInventory.status, "held"))),
    db
      .update(tripSessions)
      .set({
        // Give the freed seats back: + (seats on the cancelled bookings).
        availableSeats: sql`${tripSessions.availableSeats} + (
          SELECT COUNT(*) FROM ${bookingSeats} bs JOIN ${bookings} b ON b.id = bs.booking_id
          WHERE b.id IN (${sqlIn(ids)})
        )`,
        updatedAt: now,
      })
      .where(
        inArray(
          tripSessions.id,
          db
            .selectDistinct({ id: bookings.tripSessionId })
            .from(bookings)
            .where(inArray(bookings.id, ids)),
        ),
      ),
    // Their coupons go back to the owners while still valid, else expire
    // (Rust `release_booking` → `return_booking_coupon`).
    db
      .update(coupons)
      .set({
        status: "held",
        activeHolder: sql`(SELECT user_id FROM ${bookings} WHERE id = ${coupons.bookingId})`,
        bookingId: null,
        brandId: null,
        reservedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(coupons.status, "reserved"),
          inArray(coupons.bookingId, ids),
          or(isNull(coupons.validUntil), gt(coupons.validUntil, now)),
        ),
      ),
    db
      .update(coupons)
      .set({ status: "expired", activeHolder: null, updatedAt: now })
      .where(and(eq(coupons.status, "reserved"), inArray(coupons.bookingId, ids))),
  ]);
  return { cancelled: expired.length };
}

/** Cron: materialize trip_session + seat inventory for the 14-day sell window. */
export async function warmTrips(): Promise<{ created: number; pruned: number }> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + SELL_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Candidate schedule×date combos missing a trip_session. Recursive CTE
  // + json_each day-of-week matching — the documented raw-SQL exception
  // (see client.ts SQL POLICY).
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
    const seatCountRows = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(seats)
      .innerJoin(schedules, eq(schedules.busLayoutId, seats.busLayoutId))
      .where(eq(schedules.id, c.schedule_id));
    const seatCount = Number(seatCountRows[0]?.n ?? 0);
    const nowTs = new Date().toISOString();
    await db
      .insert(tripSessions)
      .values({
        id: crypto.randomUUID(),
        scheduleId: c.schedule_id,
        departureDate: c.date,
        status: "scheduled",
        totalSeats: seatCount,
        availableSeats: seatCount,
        createdAt: nowTs,
        updatedAt: nowTs,
      })
      .onConflictDoNothing({ target: [tripSessions.scheduleId, tripSessions.departureDate] });
    created++;
    // Materialize inventory lazily on first hold (ensureTripInventory).
  }

  // Prune departed trips' unsold inventory.
  const pruned = await db
    .delete(seatInventory)
    .where(
      and(
        eq(seatInventory.status, "available"),
        inArray(
          seatInventory.tripSessionId,
          db
            .select({ id: tripSessions.id })
            .from(tripSessions)
            .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
            .where(
              and(lt(tripSessions.departureDate, today), eq(tripSessions.status, "scheduled")),
            ),
        ),
      ),
    )
    .run()
    .then((r) => r.meta.changes);

  return { created, pruned };
}
