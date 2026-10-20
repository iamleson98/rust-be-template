/**
 * Shared fixtures for the booking/payment tests — the port of Rust
 * `service/test_support.rs`: a real D1 with the production schema, one
 * seeded trip and helpers to drive the services on top.
 *
 * Every `fixture()` call starts from empty commerce tables (the Rust tests
 * each boot a fresh in-memory database), so tests in one file cannot see
 * each other's holds.
 */
import { env } from "cloudflare:test";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration4 from "../../migrations/0004_deep_callisto.sql?raw";
import { applyMigrations } from "./migrate";
import { setCloudflareContext } from "./context";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import {
  bookingSeats,
  bookings,
  brands,
  busLayouts,
  payments,
  pickupPoints,
  routes,
  schedules,
  seatInventory,
  seats,
  tripSessions,
  users,
} from "@/lib/db/schema";
import { createBooking, type HoldRequest, type HoldResult } from "@/lib/services/booking";

export const STANDARD_FARE = 350_000;

export async function migrate(): Promise<void> {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration4);
}

export interface Fixture {
  brandId: string;
  routeId: string;
  scheduleId: string;
  layoutId: string;
  trip: string;
  seats: string[];
  /** (boarding stop, drop-off stop) of the trip's route. */
  stops: [string, string];
}

/** Empty every table the booking flow writes, children first. */
async function reset(): Promise<void> {
  const tables = [
    "coupon",
    "payment",
    "review",
    "booking_seat",
    "booking",
    "seat_inventory",
    "trip_session",
    "schedule_fare",
    "schedule_point",
    "schedule",
    "pickup_point",
    "route",
    "seat",
    "bus_layout",
    "brand",
    "audit_log",
  ];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

/** One trip with `n` bookable seats on a route with two stops. */
export async function fixture(n: number): Promise<Fixture> {
  await reset();
  const db = await getDb();
  const brandId = crypto.randomUUID();
  await db
    .insert(brands)
    .values({ id: brandId, slug: `seed-${brandId.slice(0, 8)}`, name: "Seed Brand" });
  const layoutId = crypto.randomUUID();
  await db.insert(busLayouts).values({ id: layoutId, brandId, name: "Seed Layout", totalSeats: n });
  const seatIds = Array.from({ length: n }, () => crypto.randomUUID());
  await db.insert(seats).values(
    seatIds.map((id, i) => ({
      id,
      busLayoutId: layoutId,
      seatLabel: `${String.fromCharCode(65 + i)}1`,
      floor: 1,
    })),
  );
  const routeId = crypto.randomUUID();
  await db.insert(routes).values({
    id: routeId,
    brandId,
    name: "Hà Nội - Đà Nẵng",
    startLocationId: "ha-noi",
    endLocationId: "da-nang",
  });
  const stops: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(pickupPoints).values([
    { id: stops[0], routeId, name: "Bến xe Giáp Bát", stopOrder: 1 },
    { id: stops[1], routeId, name: "Bến xe Trung tâm Đà Nẵng", stopOrder: 2 },
  ]);
  const scheduleId = crypto.randomUUID();
  await db.insert(schedules).values({
    id: scheduleId,
    routeId,
    departureTime: "08:30",
    daysOfWeek: "1111111",
    busLayoutId: layoutId,
    basePriceAdult: STANDARD_FARE,
  });
  const trip = crypto.randomUUID();
  await db.insert(tripSessions).values({
    id: trip,
    scheduleId,
    departureDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    status: "scheduled",
    totalSeats: n,
    availableSeats: n,
  });
  await db.insert(seatInventory).values(
    seatIds.map((seatId) => ({
      id: crypto.randomUUID(),
      tripSessionId: trip,
      seatId,
      status: "available",
      basePrice: STANDARD_FARE,
      finalPrice: STANDARD_FARE,
    })),
  );
  return { brandId, routeId, scheduleId, layoutId, trip, seats: seatIds, stops };
}

/** A fresh customer account (or staff when `role` says so). */
export async function owner(role: "user" | "admin" = "user"): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    fullName: "Tester",
    email: `${id.slice(0, 8)}@test.dev`,
    role,
    status: "active",
    locale: "vi",
  });
  return id;
}

/** A hold request for `seatIds` of the fixture's trip, with sensible defaults. */
export function holdReq(f: Fixture, seatIds: string[] = f.seats.slice(0, 1)): HoldRequest {
  return {
    tripId: f.trip,
    seatIds,
    passengers: seatIds.map(() => ({ name: "Nguyễn Văn A", age: 30 })),
    boardingPointId: f.stops[0],
    droppingPointId: f.stops[1],
    contactName: "Nguyễn Văn A",
    contactPhone: "0912345678",
  };
}

/** Hold the first `n` seats for `ownerId`. */
export function hold(f: Fixture, ownerId: string, n: number): Promise<HoldResult> {
  return createBooking(ownerId, holdReq(f, f.seats.slice(0, n)));
}

/** `(available, held, booked)` seat counts and the trip's counter. */
export async function seatsNow(f: Fixture): Promise<[number, number, number, number]> {
  const db = await getDb();
  const rows = await db.select().from(seatInventory).where(eq(seatInventory.tripSessionId, f.trip));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const trip = (await db.select().from(tripSessions).where(eq(tripSessions.id, f.trip)))[0];
  return [count("available"), count("held"), count("booked"), trip.availableSeats];
}

export async function booking(id: string) {
  const db = await getDb();
  return (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
}

export async function ticketsOf(id: string) {
  const db = await getDb();
  return db.select().from(bookingSeats).where(eq(bookingSeats.bookingId, id));
}

/** Pretend the hold ran out `agoSecs` ago. */
export async function ageHold(id: string, agoSecs: number): Promise<void> {
  const db = await getDb();
  await db
    .update(bookings)
    .set({ expiresAt: new Date(Date.now() - agoSecs * 1000).toISOString() })
    .where(eq(bookings.id, id));
}

/** Make the trip leave `hours` from now (negative = already left). */
export async function departIn(f: Fixture, hours: number): Promise<void> {
  const db = await getDb();
  // The schedule time is Vietnam wall-clock: render the target instant in UTC+7.
  const at = new Date(Date.now() + hours * 3_600_000 + 7 * 3_600_000).toISOString();
  await db
    .update(schedules)
    .set({ departureTime: at.slice(11, 16) })
    .where(eq(schedules.id, f.scheduleId));
  await db
    .update(tripSessions)
    .set({ departureDate: at.slice(0, 10) })
    .where(eq(tripSessions.id, f.trip));
}

/** Insert a payment row on a held booking. */
export async function payment(held: HoldResult, ownerId: string, status: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(payments).values({
    id,
    bookingId: held.bookingId,
    userId: ownerId,
    provider: "vnpay",
    status,
    amount: held.total,
    providerTxnRef: `ref-${id}`,
  });
  return id;
}

export async function paymentStatus(id: string): Promise<string> {
  const db = await getDb();
  return (await db.select().from(payments).where(eq(payments.id, id)))[0].status;
}

/** The error a promise rejects with (fails the test if it resolves). */
export async function rejection(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return { status: err.status ?? 0, message: err.message ?? String(e) };
  }
  throw new Error("expected the promise to reject");
}
