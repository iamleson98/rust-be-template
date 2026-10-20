/**
 * Where passengers get on and off — port of `trip_stops.rs`.
 *
 * A route may list its own pickup points; when it has none, the stops of
 * the schedule's timetable are the places to board and alight. A booking
 * copies the chosen stops onto itself, so a ticket keeps showing them even
 * if the timetable changes later.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { addresses, pickupPoints, schedulePoints } from "@/lib/db/schema";
import { ApiError } from "@/lib/auth/rbac";

/** One place on a trip's way. */
export interface Stop {
  id: string;
  order: number;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** `pickup` | `middle` | `drop` (or a route point's own kind). */
  kind: string | null;
  /**
   * A route pickup point (bookings reference those by id); otherwise a
   * timetable stop, kept on the booking by name only.
   */
  pickupPoint: boolean;
}

export interface StopSnapshot {
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
}

export function snapshot(stop: Stop): StopSnapshot {
  return { name: stop.name, address: stop.address, lat: stop.lat, lon: stop.lon };
}

/** The stops of a trip on `routeId` run by `scheduleId`, in order. */
export async function tripStops(routeId: string, scheduleId: string): Promise<Stop[]> {
  const db = await getDb();
  const points = await db
    .select()
    .from(pickupPoints)
    .where(eq(pickupPoints.routeId, routeId))
    .orderBy(asc(pickupPoints.stopOrder));
  if (points.length > 0) {
    return points.map((p) => ({
      id: p.id,
      order: p.stopOrder,
      name: p.name ?? "",
      address: p.address,
      lat: p.lat,
      lon: p.lon,
      kind: p.kind,
      pickupPoint: true,
    }));
  }

  const timetable = await db
    .select()
    .from(schedulePoints)
    .where(eq(schedulePoints.scheduleId, scheduleId))
    .orderBy(asc(schedulePoints.stopOrder));
  if (timetable.length === 0) return [];
  const rows = await db
    .select()
    .from(addresses)
    .where(
      inArray(
        addresses.id,
        timetable.map((p) => p.addressId),
      ),
    );
  const byId = new Map(rows.map((a) => [a.id, a]));
  const stops: Stop[] = [];
  for (const p of timetable) {
    const a = byId.get(p.addressId);
    if (!a) continue;
    stops.push({
      id: p.id,
      order: p.stopOrder,
      name: a.name,
      address: a.address,
      lat: a.lat,
      lon: a.lon,
      kind: p.kind,
      pickupPoint: false,
    });
  }
  return stops;
}

const invalid = () =>
  new ApiError(400, "validation", "choose a boarding stop and a later drop-off stop of this trip");

/**
 * The boarding and alighting stops a booking asks for, checked against the
 * trip's stops: both are required when the trip has any, must be among
 * them, and boarding must come first. Null when the trip lists no stops
 * (passengers board at the departure city).
 */
export function chooseStops(
  stops: Stop[],
  boarding?: string | null,
  dropping?: string | null,
): { on: Stop; off: Stop } | null {
  if (stops.length === 0) {
    if (boarding == null && dropping == null) return null;
    throw invalid();
  }
  const find = (id?: string | null) => (id ? stops.find((s) => s.id === id) : undefined);
  const on = find(boarding);
  const off = find(dropping);
  if (on && off && on.order < off.order) return { on, off };
  throw invalid();
}
