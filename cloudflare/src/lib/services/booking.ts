/**
 * Bookings from the customer's side — port of `booking_service.rs`: hold
 * seats, place or pay, cancel, confirm, expire.
 *
 * A booking starts `pending` with its seats held for the checkout. Paying
 * online confirms it (via the gateway webhook); paying on board places it
 * for the operator, who phones the customer and confirms it from the admin
 * console. Holds nobody placed or paid for are released by
 * `sweepExpiredHolds`.
 *
 * D1 has no interactive transactions; atomicity comes from:
 *  - `atomicBatch([...])` (one implicit transaction per batch) whose first
 *    statement claims the booking row by its current status and whose later
 *    statements only act on a booking that statement just moved (the
 *    `updated_at` stamp identifies the transition), so a confirm, a cancel
 *    and the expiry sweep can race safely: exactly one wins;
 *  - one all-or-nothing conditional UPDATE for the seat claim (Rust uses one
 *    conditional UPDATE plus a rollback of a partial claim; the observable
 *    result — 409 and nothing left behind — is the same).
 *
 * Seat state machine: available → held → booked (→ available on release).
 * Booking statuses: pending → confirmed → completed; or cancelled.
 */
import { getDb, rawAll, rawRun, atomicBatch, sqlIn, type Database } from "@/lib/db/client";
import {
  bookings,
  bookingSeats,
  brands,
  discountCampaignBrands,
  discountCampaigns,
  coupons,
  payments,
  routes,
  scheduleFares,
  schedules,
  seatInventory,
  seats,
  tripSessions,
} from "@/lib/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import { brandPrefix, genBookingCode } from "@/lib/format";
import { CAMPAIGN_CODES, couponBadRequest, couponConflict } from "./campaign-codes";
import { findCity } from "@/lib/city-match";
import {
  childPolicyOf,
  classOf,
  fareOf,
  fareTable,
  ticket as priceTicket,
  type PassengerKind,
} from "./fares";
import { chooseStops, snapshot, tripStops, type StopSnapshot } from "./trip-stops";
import { departureInstant, localToday, refundPercent, rfc3339 } from "./trip-time";
import { SELL_WINDOW_DAYS, ensureSeats } from "./trip-warmer";

// ── Constants ────────────────────────────────────────────────────

/** How long seats are held while the customer fills in the checkout. */
export const HOLD_SECS = 10 * 60;
/** Hold TTL for advance bookings — departures at least 3 days out. */
export const ADVANCE_HOLD_SECS = 20 * 60;
/** Departures this many days out or further get the advance hold TTL. */
export const ADVANCE_TTL_FROM_DAYS = 3;
/** How long a started payment keeps the seats. */
export const PAYMENT_HOLD_SECS = 15 * 60;
/** Holds released per sweep; a backlog is worked off over successive sweeps. */
const SWEEP_MAX_PER_RUN = 200;
/** D1 allows 100 bound parameters per statement; the sweep binds its id list several times. */
const SWEEP_CHUNK = 20;

type BookingRow = typeof bookings.$inferSelect;

// ── Errors (statuses the SPA depends on; messages are Rust's) ────

export const badRequest = (message: string) => new ApiError(400, "validation", message);
export const notFound = (message: string) => new ApiError(404, "not-found", message);
export const forbidden = (message: string) => new ApiError(403, "forbidden", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);
export const gone = (message: string) => new ApiError(410, "gone", message);

// ── Pure helpers ─────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Whole days from the Vietnamese `today` to the `YYYY-MM-DD` date; null if either is malformed. */
function daysFromToday(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const dep = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dep)) return null;
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localToday());
  if (!t) return null;
  return Math.round((dep - Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]))) / DAY_MS);
}

/**
 * Hold TTL for a trip departing on `departureDate` (`YYYY-MM-DD`): tiered
 * by booking horizon. Malformed dates fall back to the base TTL.
 */
export function holdSecsFor(departureDate: string): number {
  const days = daysFromToday(departureDate);
  return days != null && days >= ADVANCE_TTL_FROM_DAYS ? ADVANCE_HOLD_SECS : HOLD_SECS;
}

/** True when the booking's hold deadline has passed. */
export function holdExpired(b: Pick<BookingRow, "expiresAt">): boolean {
  if (!b.expiresAt) return false;
  const t = new Date(b.expiresAt).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

const nowIso = () => new Date().toISOString();
const nowPlus = (secs: number) => rfc3339(new Date(Date.now() + secs * 1000));
const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Convert a 64-bit integer to base36. */
export function toBase36(n: number): string {
  return n <= 0 ? "0" : n.toString(36);
}

// ── Request validation (the DTO's `#[validate]` rules) ───────────

export interface PassengerRequest {
  name: string;
  /** Ignored: the server decides from `age` and the brand's child policy. */
  type?: string | null;
  age?: number | null;
  seatId?: string | null;
}

export interface HoldRequest {
  tripId: string;
  seatIds: string[];
  passengers: PassengerRequest[];
  boardingPointId?: string | null;
  droppingPointId?: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail?: string | null;
  couponId?: string | null;
}

function validPhone(phone: string): boolean {
  if (phone.length === 0) return false;
  if (phone.startsWith("+")) return /^\d*$/.test(phone.slice(1)) && phone.length <= 16;
  return phone.startsWith("0") && /^\d+$/.test(phone) && phone.length >= 9 && phone.length <= 20;
}

/** Rust `HoldReq::validate` — field rules, one message per failure. */
export function validateHoldRequest(req: HoldRequest): void {
  const bad = (msg: string) => {
    throw badRequest(msg);
  };
  if (typeof req.tripId !== "string" || !Array.isArray(req.seatIds)) bad("invalid request body");
  if (req.seatIds.length < 1 || req.seatIds.length > 50) bad("seat ids has an invalid length");
  if (!Array.isArray(req.passengers) || req.passengers.length < 1 || req.passengers.length > 50)
    bad("passengers has an invalid length");
  for (const p of req.passengers) {
    if (typeof p.name !== "string" || p.name.length < 1 || p.name.length > 255)
      bad("name has an invalid length");
    if (p.type != null && String(p.type).length > 10) bad("type has an invalid length");
    if (p.age != null && (!Number.isInteger(p.age) || p.age < 0 || p.age > 150))
      bad("age is outside the allowed range");
  }
  if (
    typeof req.contactName !== "string" ||
    req.contactName.length < 1 ||
    req.contactName.length > 255
  )
    bad("contact name has an invalid length");
  const phone = req.contactPhone;
  if (typeof phone !== "string" || phone.length < 1 || phone.length > 20)
    bad("contact phone has an invalid length");
  if (!validPhone(phone)) bad("contact phone must be a valid phone number");
  if (req.contactEmail != null) {
    const email = req.contactEmail;
    if (email.length > 255) bad("contact email has an invalid length");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      bad("contact email must be a valid email address");
  }
}

// ── Coupon (Rust `campaign_service::coupon_discount`) ────────────

/**
 * The discount `couponId` gives on a booking of `subtotal` with operator
 * `brandId`, after checking `userId` may use it there. Reserving it is the
 * booking's last step.
 */
export async function couponDiscount(
  db: Database,
  userId: string,
  couponId: string,
  brandId: string | null,
  subtotal: number,
): Promise<number> {
  const coupon = (await db.select().from(coupons).where(eq(coupons.id, couponId)).limit(1))[0];
  if (!coupon || coupon.activeHolder !== userId || coupon.status !== "held")
    throw couponBadRequest(CAMPAIGN_CODES.UNAVAILABLE);
  if (coupon.validUntil && coupon.validUntil <= nowIso())
    throw couponBadRequest(CAMPAIGN_CODES.EXPIRED);
  const campaign = (
    await db.select().from(discountCampaigns).where(eq(discountCampaigns.id, coupon.campaignId))
  )[0];
  if (!campaign) throw couponBadRequest(CAMPAIGN_CODES.UNAVAILABLE);
  let covered = campaign.allBrands;
  if (!covered && brandId) {
    const row = await db
      .select({ brandId: discountCampaignBrands.brandId })
      .from(discountCampaignBrands)
      .where(
        and(
          eq(discountCampaignBrands.campaignId, campaign.id),
          eq(discountCampaignBrands.brandId, brandId),
        ),
      )
      .limit(1);
    covered = row.length > 0;
  }
  if (!covered) throw couponBadRequest(CAMPAIGN_CODES.WRONG_OPERATOR);
  return Math.min(Math.max(coupon.amount, 0), Math.max(subtotal, 0));
}

// ── Trip context ─────────────────────────────────────────────────

async function loadTripContext(db: Database, tripId: string) {
  const rows = await db
    .select({ trip: tripSessions, schedule: schedules, route: routes, brand: brands })
    .from(tripSessions)
    .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
    .innerJoin(routes, eq(routes.id, schedules.routeId))
    .leftJoin(brands, eq(brands.id, routes.brandId))
    .where(eq(tripSessions.id, tripId))
    .limit(1);
  return rows[0] ?? null;
}

// ── Hold ─────────────────────────────────────────────────────────

export interface HoldSeat {
  seatId: string;
  seatCode: string | null;
  seatClass: string;
  passengerName: string;
  passengerType: PassengerKind;
  passengerAge: number | null;
  price: number;
}

export interface HoldResult {
  bookingId: string;
  code: string;
  status: "pending";
  subtotal: number;
  discount: number;
  fees: number;
  total: number;
  expiresAt: string;
  seats: HoldSeat[];
  couponId: string | null;
}

/** All-or-nothing seat claim. True when every seat was claimed. */
async function claimSeats(
  tripId: string,
  seatIds: string[],
  bookingId: string,
  heldUntil: string,
): Promise<boolean> {
  // The seat ids travel as ONE bound JSON parameter so the claim fits D1's
  // 100-parameter cap whatever the party size.
  const ids = JSON.stringify(seatIds);
  const now = nowIso();
  const res = await rawRun(sql`
    UPDATE seat_inventory
       SET status = 'held', held_by_booking_id = ${bookingId}, held_until = ${heldUntil},
           updated_at = ${now}
     WHERE trip_session_id = ${tripId} AND status = 'available'
       AND seat_id IN (SELECT value FROM json_each(${ids}))
       AND (SELECT COUNT(*) FROM seat_inventory x
             WHERE x.trip_session_id = ${tripId} AND x.status = 'available'
               AND x.seat_id IN (SELECT value FROM json_each(${ids}))) = ${seatIds.length}
  `);
  return res.meta.changes === seatIds.length;
}

async function releaseHeldSeats(db: Database, bookingId: string): Promise<void> {
  await db
    .update(seatInventory)
    .set({ status: "available", heldByBookingId: null, heldUntil: null, updatedAt: nowIso() })
    .where(eq(seatInventory.heldByBookingId, bookingId))
    .run();
}

/** Lock seats + create a pending booking (10-minute hold, 20 for advance bookings). */
export async function createBooking(userId: string, req: HoldRequest): Promise<HoldResult> {
  validateHoldRequest(req);
  if (req.seatIds.length === 0 || req.contactName.trim() === "" || req.contactPhone.trim() === "")
    throw badRequest("missing required fields");
  if (req.passengers.length !== req.seatIds.length)
    throw badRequest("passenger count must match seat count");

  const db = await getDb();
  const ctx = await loadTripContext(db, req.tripId);
  if (!ctx) throw notFound("trip not found");
  const { trip, schedule, route, brand } = ctx;
  if (trip.status === "cancelled") throw badRequest("trip is cancelled");

  // A trip that has left cannot be sold.
  const departs = departureInstant(
    trip.departureDate,
    schedule.departureTime,
    trip.actualDepartureAt,
  );
  if (departs && departs.getTime() <= Date.now()) throw badRequest("trip has already departed");

  // The sell window IS the operator's booking horizon.
  const daysOut = daysFromToday(trip.departureDate);
  if (daysOut != null && daysOut > SELL_WINDOW_DAYS)
    throw badRequest(`bookings open ${SELL_WINDOW_DAYS} days before departure`);

  // Where the passengers get on and off, copied onto the booking.
  const stops = await tripStops(route.id, schedule.id);
  const chosen = chooseStops(stops, req.boardingPointId, req.droppingPointId);
  const cityStop = (slug: string): StopSnapshot | null => {
    const c = findCity(slug);
    return c ? { name: c.name, address: null, lat: c.lat, lon: c.lon } : null;
  };
  const pickup = chosen ? snapshot(chosen.on) : cityStop(route.startLocationId);
  const dropoff = chosen ? snapshot(chosen.off) : cityStop(route.endLocationId);

  await ensureSeats(db, trip.id, schedule);

  // Seat inventories: every requested seat must exist and be on sale.
  const distinctIds = [...new Set(req.seatIds)];
  const invs = await db
    .select()
    .from(seatInventory)
    .where(
      and(eq(seatInventory.tripSessionId, trip.id), inArray(seatInventory.seatId, distinctIds)),
    );
  if (invs.length !== req.seatIds.length) throw badRequest("some seats not found or changed");
  if (invs.some((s) => s.status !== "available"))
    throw conflict("some seats are no longer available");

  // Pair each passenger with their seat: the seat they name when every
  // passenger names one, otherwise the seat at their position in seatIds.
  const requested = new Set(req.seatIds);
  if (requested.size !== req.seatIds.length) throw badRequest("a seat is listed twice");
  const invBySeat = new Map(invs.map((s) => [s.seatId, s]));
  const named = req.passengers.every((p) => p.seatId != null);
  const taken = new Set<string>();
  const seated = req.passengers.map((passenger, i) => {
    const seat = named ? (passenger.seatId ?? req.seatIds[i]) : req.seatIds[i];
    if (!requested.has(seat) || taken.has(seat))
      throw badRequest("each passenger needs a different seat from seatIds");
    taken.add(seat);
    const inv = invBySeat.get(seat);
    if (!inv) throw badRequest("some seats not found or changed");
    return { passenger, inv };
  });

  // Pricing: each passenger pays for their seat's class, at the child price
  // when the brand sells child tickets and the age qualifies.
  const seatRows = await db
    .select({ id: seats.id, label: seats.seatLabel, seatClass: seats.seatClass })
    .from(seats)
    .where(inArray(seats.id, distinctIds));
  const seatById = new Map(seatRows.map((s) => [s.id, s]));
  const fareRows = await db
    .select()
    .from(scheduleFares)
    .where(eq(scheduleFares.scheduleId, schedule.id));
  const table = fareTable(schedule, fareRows);
  const policy = childPolicyOf(brand);
  const tickets = seated.map(({ passenger, inv }) => {
    const seat = seatById.get(inv.seatId);
    const cls = seat ? classOf(seat) : "standard";
    const fare = fareOf(table, cls);
    const age = passenger.age ?? null;
    const t = age != null ? priceTicket(age, inv.finalPrice, fare, policy) : null;
    return {
      seatId: inv.seatId,
      seatCode: seat?.label ?? null,
      seatClass: cls,
      passengerName: passenger.name,
      passengerAge: age,
      passengerType: t?.kind ?? ("adult" as PassengerKind),
      price: t?.price ?? inv.finalPrice,
    };
  });
  const childCount = tickets.filter((t) => t.passengerType === "child").length;
  const adultCount = tickets.length - childCount;
  const subtotal = tickets.reduce((sum, t) => sum + t.price, 0);

  // Coupon discount: checked here, reserved as the hold's last step.
  const discountRaw = req.couponId
    ? await couponDiscount(db, userId, req.couponId, route.brandId, subtotal)
    : 0;
  // A promo can never be worth more than the order.
  const discount = Math.min(Math.max(discountRaw, 0), subtotal);
  const fees = 0;
  const total = Math.max(subtotal - discount + fees, 0);

  const expiresAt = nowPlus(holdSecsFor(trip.departureDate));
  const code = genBookingCode(brandPrefix(brand?.slug ?? ""));
  const bookingId = crypto.randomUUID();
  const now = nowIso();

  // Claim ALL the seats in ONE conditional UPDATE (the engine serializes
  // it, so concurrent holds on overlapping seats resolve one winner).
  const claimed = await claimSeats(trip.id, req.seatIds, bookingId, expiresAt);
  if (!claimed) throw conflict("some seats are no longer available");

  try {
    await atomicBatch([
      db.insert(bookings).values({
        id: bookingId,
        code,
        // Bind the booking to its owner so cancel/confirm can verify it.
        userId,
        tripSessionId: trip.id,
        boardingPointId: chosen?.on.pickupPoint ? chosen.on.id : null,
        droppingPointId: chosen?.off.pickupPoint ? chosen.off.id : null,
        pickupName: pickup?.name ?? null,
        pickupAddress: pickup?.address ?? null,
        pickupLat: pickup?.lat != null ? String(pickup.lat) : null,
        pickupLon: pickup?.lon != null ? String(pickup.lon) : null,
        dropoffName: dropoff?.name ?? null,
        dropoffAddress: dropoff?.address ?? null,
        dropoffLat: dropoff?.lat != null ? String(dropoff.lat) : null,
        dropoffLon: dropoff?.lon != null ? String(dropoff.lon) : null,
        adultCount,
        childCount,
        subtotal,
        discount,
        fees,
        total,
        currency: "VND",
        status: "pending",
        paymentMethod: null,
        campaignAppliedId: req.couponId ?? null,
        expiresAt,
        contactName: req.contactName,
        contactPhone: req.contactPhone,
        contactEmail: req.contactEmail ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      ...tickets.map((t) =>
        db.insert(bookingSeats).values({
          id: crypto.randomUUID(),
          bookingId,
          seatId: t.seatId,
          passengerName: t.passengerName,
          passengerAge: t.passengerAge,
          passengerType: t.passengerType,
          price: t.price,
          createdAt: now,
        }),
      ),
    ]);
  } catch (e) {
    // Line items failed — hand the seats back; the hold leaves NOTHING behind.
    await releaseHeldSeats(db, bookingId);
    await db.delete(bookings).where(eq(bookings.id, bookingId));
    throw e;
  }

  // Put the coupon on the booking. It changed since the check (used on
  // another booking, expired, given up): undo the whole hold.
  if (req.couponId) {
    const reserved = await rawRun(sql`
      UPDATE coupon SET status = 'reserved', booking_id = ${bookingId}, brand_id = ${route.brandId},
             reserved_at = ${now}, updated_at = ${now}
       WHERE id = ${req.couponId} AND active_holder = ${userId} AND status = 'held'
         AND (valid_until IS NULL OR valid_until > ${now})
    `);
    if (reserved.meta.changes !== 1) {
      await releaseHeldSeats(db, bookingId);
      await db.delete(bookings).where(eq(bookings.id, bookingId));
      throw couponConflict(CAMPAIGN_CODES.UNAVAILABLE);
    }
  }

  // The seat claim is the correctness gate; this keeps the trip's counter.
  await db
    .update(tripSessions)
    .set({ availableSeats: sql`${tripSessions.availableSeats} - ${tickets.length}` })
    .where(eq(tripSessions.id, trip.id))
    .run();

  return {
    bookingId,
    code,
    status: "pending",
    subtotal,
    discount,
    fees,
    total,
    expiresAt,
    seats: tickets.map((t) => ({
      seatId: t.seatId,
      seatCode: t.seatCode,
      seatClass: t.seatClass,
      passengerName: t.passengerName,
      passengerType: t.passengerType,
      passengerAge: t.passengerAge,
      price: t.price,
    })),
    couponId: req.couponId ?? null,
  };
}

// ── Reads ────────────────────────────────────────────────────────

/** A booking by id, or by its code (any case, surrounding space ignored). */
export async function findBooking(idOrCode: string): Promise<BookingRow | null> {
  const db = await getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
  const rows = await db
    .select()
    .from(bookings)
    .where(
      isUuid
        ? eq(bookings.id, idOrCode.toLowerCase())
        : eq(bookings.code, idOrCode.trim().toUpperCase()),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** A booking, if `caller` owns it. */
export async function ownedBooking(callerId: string, idOrCode: string): Promise<BookingRow> {
  const b = await findBooking(idOrCode);
  if (!b) throw notFound("booking not found");
  if (b.userId !== callerId) throw forbidden("not your booking");
  return b;
}

/** When `b`'s trip leaves, if its trip and schedule still exist. */
export async function departureOf(b: Pick<BookingRow, "tripSessionId">): Promise<Date | null> {
  const db = await getDb();
  const row = (
    await db
      .select({ trip: tripSessions, time: schedules.departureTime })
      .from(tripSessions)
      .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
      .where(eq(tripSessions.id, b.tripSessionId))
      .limit(1)
  )[0];
  if (!row) return null;
  return departureInstant(row.trip.departureDate, row.time, row.trip.actualDepartureAt);
}

// ── Transitions ──────────────────────────────────────────────────
//
// Each is ONE atomic batch guarded by the booking's current state.

export type ConfirmOutcome = "confirmed" | "not-pending" | "seats-lost";

/**
 * `pending` → `confirmed` and the booking's held seats → `booked`. Nothing
 * changes unless the booking is pending AND still holds all of its seats.
 */
export async function confirmPending(
  bookingId: string,
  paymentMethod: string,
): Promise<ConfirmOutcome> {
  const now = nowIso();
  const [claim] = await atomicBatch([
    sql`
      UPDATE booking SET status = 'confirmed', payment_method = ${paymentMethod}, updated_at = ${now}
       WHERE id = ${bookingId} AND status = 'pending'
         AND (SELECT COUNT(*) FROM booking_seat WHERE booking_id = ${bookingId}) > 0
         AND (SELECT COUNT(*) FROM seat_inventory
               WHERE held_by_booking_id = ${bookingId} AND status = 'held')
           = (SELECT COUNT(*) FROM booking_seat WHERE booking_id = ${bookingId})
    `,
    sql`
      UPDATE seat_inventory SET status = 'booked', held_until = NULL, updated_at = ${now}
       WHERE held_by_booking_id = ${bookingId} AND status = 'held'
         AND EXISTS (SELECT 1 FROM booking
                      WHERE id = ${bookingId} AND status = 'confirmed' AND updated_at = ${now})
    `,
  ]);
  if (claim.meta.changes === 1) return "confirmed";
  const b = (await (await getDb()).select().from(bookings).where(eq(bookings.id, bookingId)))[0];
  return b && b.status === "pending" ? "seats-lost" : "not-pending";
}

/** What a released booking gave back. */
export interface Released {
  bookings: number;
  seats: number;
}

/**
 * Shared body of cancel and expiry: flip the booking to `cancelled` and
 * undo everything the hold did, atomically. Null when nothing was done
 * (someone else moved the booking, or — for expiry — it was extended).
 * `expiredBefore` makes it expiry: the hold must still be expired then.
 */
async function releaseBookings(
  ids: string[],
  from: string[],
  expiredBefore?: string,
): Promise<Released | null> {
  const now = nowIso();
  const stamped = sql`id IN (${sqlIn(ids)}) AND status = 'cancelled' AND updated_at = ${now}`;
  const results = await atomicBatch([
    sql`
      UPDATE booking SET status = 'cancelled', updated_at = ${now}
       WHERE id IN (${sqlIn(ids)}) AND status IN (${sqlIn(from)})
         ${expiredBefore ? sql`AND expires_at IS NOT NULL AND expires_at < ${expiredBefore}` : sql``}
    `,
    // The trip's counter gets back exactly the seats this release frees —
    // computed before they are freed, by the engine (no read-modify-write).
    sql`
      UPDATE trip_session
         SET available_seats = available_seats + (
               SELECT COUNT(*) FROM seat_inventory si JOIN booking b ON b.id = si.held_by_booking_id
                WHERE b.trip_session_id = trip_session.id AND b.id IN (${sqlIn(ids)})
                  AND b.status = 'cancelled' AND b.updated_at = ${now})
       WHERE id IN (SELECT trip_session_id FROM booking WHERE ${stamped})
    `,
    sql`
      UPDATE seat_inventory
         SET status = 'available', held_until = NULL, held_by_booking_id = NULL, updated_at = ${now}
       WHERE held_by_booking_id IN (SELECT id FROM booking WHERE ${stamped})
    `,
    // The trip will not happen: its coupon goes back to its owner while
    // still valid, else it expires (which frees the owner to claim another).
    sql`
      UPDATE coupon
         SET status = 'held', booking_id = NULL, brand_id = NULL, reserved_at = NULL, updated_at = ${now},
             active_holder = COALESCE(active_holder, (SELECT user_id FROM booking WHERE id = coupon.booking_id))
       WHERE status = 'reserved' AND (valid_until IS NULL OR valid_until > ${now})
         AND booking_id IN (SELECT id FROM booking WHERE ${stamped})
    `,
    sql`
      UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
       WHERE status = 'reserved' AND booking_id IN (SELECT id FROM booking WHERE ${stamped})
    `,
    sql`
      UPDATE payment SET status = 'cancelled', updated_at = ${now}, failure_reason = 'booking cancelled'
       WHERE status = 'pending' AND booking_id IN (SELECT id FROM booking WHERE ${stamped})
    `,
  ]);
  const cancelled = results[0].meta.changes;
  if (cancelled === 0) return null;
  return { bookings: cancelled, seats: results[2].meta.changes };
}

/** Cancel a booking whose status is one of `from`. */
export function cancelBookingRow(bookingId: string, from: string[]): Promise<Released | null> {
  return releaseBookings([bookingId], from);
}

/** `confirmed` → `completed`; the trip happened, so its coupon becomes payable. */
export async function completeBooking(bookingId: string): Promise<boolean> {
  const now = nowIso();
  const [done] = await atomicBatch([
    sql`UPDATE booking SET status = 'completed', updated_at = ${now}
         WHERE id = ${bookingId} AND status = 'confirmed'`,
    sql`
      UPDATE coupon SET status = 'redeemed', active_holder = NULL, redeemed_at = ${now}, updated_at = ${now}
       WHERE booking_id = ${bookingId} AND status = 'reserved'
         AND EXISTS (SELECT 1 FROM booking
                      WHERE id = ${bookingId} AND status = 'completed' AND updated_at = ${now})
    `,
  ]);
  return done.meta.changes === 1;
}

/**
 * Record how a pending booking will be paid and hold its seats until
 * `holdUntil` (RFC 3339). False when it is no longer pending.
 */
export async function placePending(
  bookingId: string,
  paymentMethod: string,
  holdUntil: string,
): Promise<boolean> {
  const now = nowIso();
  const [placed] = await atomicBatch([
    sql`UPDATE booking SET payment_method = ${paymentMethod}, expires_at = ${holdUntil}, updated_at = ${now}
         WHERE id = ${bookingId} AND status = 'pending'`,
    sql`
      UPDATE seat_inventory SET held_until = ${holdUntil}
       WHERE held_by_booking_id = ${bookingId} AND status = 'held'
         AND EXISTS (SELECT 1 FROM booking
                      WHERE id = ${bookingId} AND status = 'pending' AND updated_at = ${now})
    `,
  ]);
  return placed.meta.changes === 1;
}

// ── Customer actions ─────────────────────────────────────────────

export interface CancelResult {
  success: true;
  refundPercent: number;
  refundAmount: number;
  cancelledAt: string;
  refCode: string;
  reason: string | null;
}

/** `(percent, amount)` handed back for cancelling `b` now: the policy share of the completed payments. */
async function refundFor(
  b: BookingRow,
  departs: Date | null,
): Promise<{ percent: number; amount: number }> {
  const db = await getDb();
  const rows = await db.select().from(payments).where(eq(payments.bookingId, b.id));
  const paid = rows
    .filter((p) => p.status === "completed")
    .reduce((s, p) => s + Number(p.amount), 0);
  if (paid <= 0) return { percent: 0, amount: 0 };
  // Departure unknown: refund at the top tier.
  const percent = departs
    ? refundPercent(Math.trunc((departs.getTime() - Date.now()) / 60_000) / 60)
    : 90;
  return { percent, amount: Math.floor((paid * percent) / 100) };
}

/**
 * The customer cancels their booking: the seats go back on sale and any
 * completed payment is refunded at the policy rate. Allowed while the
 * booking is open and the trip has not left.
 */
export async function cancelBooking(
  callerId: string,
  idOrCode: string,
  reason?: string | null,
): Promise<CancelResult> {
  const b = await ownedBooking(callerId, idOrCode);
  if (b.status === "cancelled") throw badRequest("booking already cancelled");
  if (b.status !== "pending" && b.status !== "confirmed")
    throw badRequest(`a ${b.status} booking cannot be cancelled`);
  const departs = await departureOf(b);
  if (departs && departs.getTime() <= Date.now()) throw badRequest("the trip has already left");

  const refund = await refundFor(b, departs);
  // Seats, counter, promo use and pending payments move together or not at all.
  const released = await cancelBookingRow(b.id, ["pending", "confirmed"]);
  if (!released) throw conflict("booking was changed by another request");

  return {
    success: true,
    refundPercent: refund.percent,
    refundAmount: refund.amount,
    cancelledAt: nowIso(),
    refCode: `HX-${b.code.toUpperCase()}-${toBase36(Date.now()).toUpperCase()}`,
    reason: reason ?? null,
  };
}

export interface ConfirmResponse {
  bookingId: string;
  status: string;
  paymentMethod: string;
}

/**
 * Keep a pending booking's seats until its trip leaves (a pay-on-board
 * booking waiting for the operator's call).
 */
export async function holdUntilDeparture(
  b: Pick<BookingRow, "id" | "tripSessionId">,
  method: string,
): Promise<boolean> {
  const departs = (await departureOf(b)) ?? new Date(Date.now() + DAY_MS);
  return placePending(b.id, method, rfc3339(departs));
}

/**
 * Keep a booking's seats while its online payment is in progress: the
 * customer needs longer than the checkout hold to finish at a gateway.
 */
export function holdForPayment(id: string, provider: string): Promise<boolean> {
  return placePending(id, provider, nowPlus(PAYMENT_HOLD_SECS));
}

/**
 * The customer chooses to pay on board. The booking is placed: its seats
 * stay held until departure while the operator phones the customer and
 * confirms it from the admin console.
 */
export async function placeCash(callerId: string, idOrCode: string): Promise<ConfirmResponse> {
  const b = await ownedBooking(callerId, idOrCode);
  if (b.status !== "pending") throw badRequest("booking is not in pending status");
  if (holdExpired(b)) {
    // Too late: hand the seats back right away.
    await releaseBookings([b.id], ["pending"], rfc3339(new Date()));
    throw gone("booking hold has expired");
  }
  if (!(await holdUntilDeparture(b, "cod")))
    throw conflict("booking was changed by another request");
  return { bookingId: b.id, status: "pending", paymentMethod: "cod" };
}

/**
 * Confirm after a verified payment (gateway webhook, driver collecting
 * cash). Money has changed hands, so a hold that ran past its deadline
 * still converts as long as nothing released the seats yet. Idempotent: a
 * repeated notification for a booking that is already confirmed succeeds.
 */
export async function confirmAsSystem(id: string, paymentMethod: string): Promise<ConfirmResponse> {
  const db = await getDb();
  const b = (await db.select().from(bookings).where(eq(bookings.id, id)).limit(1))[0];
  if (!b) throw notFound("booking not found");
  if (b.status === "confirmed")
    return {
      bookingId: b.id,
      status: "confirmed",
      paymentMethod: b.paymentMethod ?? paymentMethod,
    };
  if (b.status !== "pending") throw conflict(`booking is ${b.status}`);
  const outcome = await confirmPending(b.id, paymentMethod);
  if (outcome === "confirmed") return { bookingId: b.id, status: "confirmed", paymentMethod };
  if (outcome === "not-pending") throw badRequest("booking is not in pending status");
  throw gone("booking hold has expired");
}

// ── Expiry sweep ─────────────────────────────────────────────────

/**
 * Give back every hold that ran out: the booking is cancelled, its seats
 * are free again, its pending payments are cancelled, its coupon goes back
 * and the trip's counter is restored. Run on a timer (60 s cadence); safe
 * to call concurrently with confirms and cancels.
 */
export async function sweepExpiredHolds(): Promise<{ cancelled: number; seats: number }> {
  const now = rfc3339(new Date());
  const expired = await rawAll<{ id: string }>(sql`
    SELECT id FROM booking
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ${now}
     ORDER BY expires_at ASC LIMIT ${SWEEP_MAX_PER_RUN}
  `);
  let cancelled = 0;
  let freed = 0;
  // D1 allows 100 bound parameters per statement and each batch statement
  // binds the id list, so release in small atomic chunks — an outage backlog
  // drains over a few ticks instead of failing forever.
  for (const ids of chunk(
    expired.map((e) => e.id),
    SWEEP_CHUNK,
  )) {
    const done = await releaseBookings(ids, ["pending"], now);
    if (done) {
      cancelled += done.bookings;
      freed += done.seats;
    }
  }
  return { cancelled, seats: freed };
}
