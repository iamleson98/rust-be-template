/**
 * A small catalog builder for the public-read tests (search, detail,
 * recommendations, brands, routes, stats): brands, layouts, routes,
 * schedules and trips in a real D1, one call each, with the defaults a
 * test rarely cares about.
 */
import { env } from "cloudflare:test";
import { getDb } from "@/lib/db/client";
import {
  addresses,
  brands,
  busLayouts,
  pickupPoints,
  routes,
  scheduleFares,
  schedulePoints,
  schedules,
  seatInventory,
  seats,
  tripSessions,
  vehicleTypes,
} from "@/lib/db/schema";
import { localToday } from "@/lib/services/trip-time";

export const DAY_MS = 86_400_000;

/** The Vietnamese date `days` from today. */
export const vnDay = (days: number): string =>
  new Date(Date.parse(`${localToday()}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The first Vietnamese date from tomorrow on that falls on `weekday` (Mon=1 … Sun=7). */
export function nextWeekday(weekday: number): string {
  for (let d = 1; d <= 7; d++) {
    const day = vnDay(d);
    if (((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 === weekday) return day;
  }
  throw new Error("unreachable");
}

/** Empty every table the catalog touches, children first. */
export async function resetCatalog(): Promise<void> {
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
    "address",
    "vehicle_type",
    "brand",
  ];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

let nextSlug = 1;

export async function addBrand(over: Partial<typeof brands.$inferInsert> = {}): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const n = nextSlug++;
  await db.insert(brands).values({ id, slug: `brand-${n}`, name: `Brand ${n}`, ...over });
  return id;
}

export async function addVehicleType(over: Partial<typeof vehicleTypes.$inferInsert> = {}) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(vehicleTypes).values({ id, code: "limousine", label: "Limousine", ...over });
  return id;
}

export interface SeatSpec {
  label: string;
  seatClass?: string;
  row?: number;
  col?: number;
  floor?: number;
}

/** A layout with these seats (`n` standard seats `A1…` when a number is given). */
export async function addLayout(
  brandId: string,
  seatSpecs: number | SeatSpec[],
  over: Partial<typeof busLayouts.$inferInsert> = {},
): Promise<{ id: string; seatIds: string[] }> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const specs: SeatSpec[] =
    typeof seatSpecs === "number"
      ? Array.from({ length: seatSpecs }, (_, i) => ({
          label: `A${i + 1}`,
          row: i + 1,
          col: 1,
        }))
      : seatSpecs;
  await db
    .insert(busLayouts)
    .values({ id, brandId, name: "Layout", totalSeats: specs.length, ...over });
  const seatIds = specs.map(() => crypto.randomUUID());
  if (specs.length > 0) {
    await db.insert(seats).values(
      specs.map((s, i) => ({
        id: seatIds[i]!,
        busLayoutId: id,
        seatLabel: s.label,
        seatClass: s.seatClass ?? null,
        rowNum: s.row ?? i + 1,
        colNum: s.col ?? 1,
        floor: s.floor ?? 1,
      })),
    );
  }
  return { id, seatIds };
}

export async function addRoute(
  brandId: string | null,
  from = "ha-noi",
  to = "ho-chi-minh",
  over: Partial<typeof routes.$inferInsert> = {},
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(routes).values({
    id,
    brandId,
    name: `${from} - ${to}`,
    startLocationId: from,
    endLocationId: to,
    ...over,
  });
  return id;
}

export async function addSchedule(
  routeId: string,
  over: Partial<typeof schedules.$inferInsert> = {},
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db
    .insert(schedules)
    .values({ id, routeId, departureTime: "08:00", basePriceAdult: 200_000, ...over });
  return id;
}

export async function addFare(scheduleId: string, seatClass: string, priceAdult: number) {
  const db = await getDb();
  await db
    .insert(scheduleFares)
    .values({ id: crypto.randomUUID(), scheduleId, seatClass, priceAdult });
}

export async function addTrip(
  scheduleId: string,
  date: string,
  over: Partial<typeof tripSessions.$inferInsert> = {},
): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(tripSessions).values({
    id,
    scheduleId,
    departureDate: date,
    totalSeats: 40,
    availableSeats: 40,
    ...over,
  });
  return id;
}

/** Seat rows for a trip, one per seat, at these prices (default 200 000). */
export async function openTrip(
  tripId: string,
  seatIds: string[],
  prices: number[] = [],
  statuses: string[] = [],
) {
  const db = await getDb();
  await db.insert(seatInventory).values(
    seatIds.map((seatId, i) => ({
      id: crypto.randomUUID(),
      tripSessionId: tripId,
      seatId,
      status: statuses[i] ?? "available",
      basePrice: prices[i] ?? 200_000,
      finalPrice: prices[i] ?? 200_000,
    })),
  );
}

export interface StopSpec {
  name: string;
  lat: number;
  lon: number;
  arrival?: string;
}

/** A timetable for a schedule: one address and one schedule point per stop, in order. */
export async function addTimetable(brandId: string, scheduleId: string, stops: StopSpec[]) {
  const db = await getDb();
  for (const [i, s] of stops.entries()) {
    const addressId = crypto.randomUUID();
    await db.insert(addresses).values({
      id: addressId,
      brandId,
      name: s.name,
      address: `${s.name} street`,
      lat: s.lat,
      lon: s.lon,
    });
    await db.insert(schedulePoints).values({
      id: crypto.randomUUID(),
      scheduleId,
      addressId,
      stopOrder: i + 1,
      kind: i === 0 ? "pickup" : i === stops.length - 1 ? "drop" : "middle",
      arrivalTime: s.arrival ?? null,
    });
  }
}

/** Route pickup points, in order. */
export async function addPickupPoints(routeId: string, stops: StopSpec[]) {
  const db = await getDb();
  await db.insert(pickupPoints).values(
    stops.map((s, i) => ({
      id: crypto.randomUUID(),
      routeId,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      stopOrder: i + 1,
    })),
  );
}

export async function tripRows(scheduleId: string) {
  const db = await getDb();
  const { eq } = await import("drizzle-orm");
  return db.select().from(tripSessions).where(eq(tripSessions.scheduleId, scheduleId));
}
