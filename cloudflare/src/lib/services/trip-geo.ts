/**
 * Coordinate search — port of `PublicService::search_trips_geo`: trips on a
 * date that stop within a distance of both the customer's pickup and
 * drop-off (in that order), each with the stop pair nearest them.
 *
 * A schedule with a timetable of its own is matched on ITS stops (with the
 * time the bus is there); one without on its route's pickup points. Stops
 * are found through the `(lat, lon)` columns inside a box around each
 * place, then measured exactly.
 */
import { and, between, eq, isNotNull, or, type SQLWrapper } from "drizzle-orm";
import { getDb, inList } from "@/lib/db/client";
import { addresses, pickupPoints, routes, schedulePoints, schedules } from "@/lib/db/schema";
import { results, toCandidates, tripsOn, GEO_TRIP_CAP } from "./trip-search";
import type { RouteRow, ScheduleRow } from "./trip-cards";
import type { TripSearchResponse, TripStopMatch } from "./trip-results";
import type { SearchOptions } from "./trip-search-options";

export type LatLon = readonly [lat: number, lon: number];

/** A stop of a trip near a searched place. */
export interface StopHit {
  order: number;
  name: string;
  /** `HH:MM` the bus is there, when the timetable says. */
  time?: string;
  lat: number;
  lon: number;
}

export interface GeoBox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** Where the bus stops for the customer: the pickup and the drop-off. */
export type StopPair = readonly [pickup: TripStopMatch, dropoff: TripStopMatch];

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km (Rust `haversine_km`). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * The box around `center` that holds every point within `km` (degrees; a
 * little wider, the exact distance is measured afterwards).
 */
export function geoBox([lat, lon]: LatLon, km: number): GeoBox {
  const latDelta = (km / 111) * 1.2;
  const lonDelta = (km / (111 * Math.max(Math.abs(Math.cos(rad(lat))), 0.01))) * 1.2;
  return {
    latMin: lat - latDelta,
    latMax: lat + latDelta,
    lonMin: lon - lonDelta,
    lonMax: lon + lonDelta,
  };
}

/**
 * The pickup stop near `from` and a later drop-off stop near `to` (both
 * within `max` km) with the smallest total distance; null when the trip
 * does not serve both in that order.
 */
export function nearestPair(
  hits: StopHit[],
  from: LatLon,
  to: LatLon,
  max: number,
): StopPair | null {
  const near = ([lat, lon]: LatLon) =>
    hits
      .map((hit) => ({ hit, km: haversineKm(lat, lon, hit.lat, hit.lon) }))
      .filter((h) => h.km <= max);
  const dropoffs = near(to);
  let best: { pickup: ReturnType<typeof near>[number]; dropoff: (typeof dropoffs)[number] } | null =
    null;
  for (const pickup of near(from)) {
    for (const dropoff of dropoffs) {
      if (dropoff.hit.order <= pickup.hit.order) continue;
      if (!best || pickup.km + dropoff.km < best.pickup.km + best.dropoff.km)
        best = { pickup, dropoff };
    }
  }
  if (!best) return null;
  const stop = ({ hit, km }: { hit: StopHit; km: number }): TripStopMatch => ({
    name: hit.name,
    time: hit.time,
    distanceKm: Math.round(km * 10) / 10,
  });
  return [stop(best.pickup), stop(best.dropoff)];
}

function groupBy<K, V>(items: Iterable<[K, V]>): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const [key, value] of items) out.set(key, [...(out.get(key) ?? []), value]);
  return out;
}

/** The stop pair of each group of stops that serves both places. */
function pairsOf(
  groups: Map<string, StopHit[]>,
  from: LatLon,
  to: LatLon,
  max: number,
): Map<string, StopPair> {
  const out = new Map<string, StopPair>();
  for (const [id, hits] of groups) {
    const pair = nearestPair(hits, from, to, max);
    if (pair) out.set(id, pair);
  }
  return out;
}

const inside = (boxes: GeoBox[], lat: SQLWrapper, lon: SQLWrapper) =>
  or(...boxes.map((b) => and(between(lat, b.latMin, b.latMax), between(lon, b.lonMin, b.lonMax))));

/** Timetable stops (with the time the bus is there) inside either box, by schedule. */
async function scheduleStops(boxes: GeoBox[]): Promise<Map<string, StopHit[]>> {
  const db = await getDb();
  const rows = await db
    .select({
      scheduleId: schedulePoints.scheduleId,
      order: schedulePoints.stopOrder,
      time: schedulePoints.arrivalTime,
      name: addresses.name,
      lat: addresses.lat,
      lon: addresses.lon,
    })
    .from(schedulePoints)
    .innerJoin(addresses, eq(addresses.id, schedulePoints.addressId))
    .where(inside(boxes, addresses.lat, addresses.lon));
  return groupBy(
    rows.flatMap((r): Array<[string, StopHit]> =>
      r.lat == null || r.lon == null
        ? []
        : [
            [
              r.scheduleId,
              { order: r.order, name: r.name, time: r.time || undefined, lat: r.lat, lon: r.lon },
            ],
          ],
    ),
  );
}

/** Pickup points of active routes inside either box, by route. */
async function routeStops(boxes: GeoBox[]): Promise<Map<string, StopHit[]>> {
  const db = await getDb();
  const rows = await db
    .select({
      routeId: pickupPoints.routeId,
      order: pickupPoints.stopOrder,
      name: pickupPoints.name,
      lat: pickupPoints.lat,
      lon: pickupPoints.lon,
    })
    .from(pickupPoints)
    .innerJoin(routes, eq(routes.id, pickupPoints.routeId))
    .where(
      and(
        eq(routes.status, "active"),
        isNotNull(pickupPoints.lat),
        isNotNull(pickupPoints.lon),
        inside(boxes, pickupPoints.lat, pickupPoints.lon),
      ),
    );
  return groupBy(
    rows.flatMap((r): Array<[string, StopHit]> =>
      r.lat == null || r.lon == null
        ? []
        : [[r.routeId, { order: r.order, name: r.name ?? "", lat: r.lat, lon: r.lon }]],
    ),
  );
}

/** The schedules to search and where the customer boards each. */
async function boardingSchedules(
  from: LatLon,
  to: LatLon,
  max: number,
): Promise<{ schedules: ScheduleRow[]; boarding: Map<string, StopPair> }> {
  const db = await getDb();
  const boxes = [geoBox(from, max), geoBox(to, max)];

  // 1. Schedules whose own stops are near both places.
  const boarding = pairsOf(await scheduleStops(boxes), from, to, max);
  // 2. Routes whose pickup points are near both — for their schedules without a timetable.
  const routeBoarding = pairsOf(await routeStops(boxes), from, to, max);

  const found = await db
    .select()
    .from(schedules)
    .where(inList(schedules.id, [...boarding.keys()]));
  if (routeBoarding.size > 0) {
    const byRoute = await db
      .select()
      .from(schedules)
      .where(inList(schedules.routeId, [...routeBoarding.keys()]));
    const timed = new Set(
      (
        await db
          .select({ scheduleId: schedulePoints.scheduleId })
          .from(schedulePoints)
          .where(
            inList(
              schedulePoints.scheduleId,
              byRoute.map((s) => s.id),
            ),
          )
      ).map((p) => p.scheduleId),
    );
    for (const s of byRoute) {
      const pair = routeBoarding.get(s.routeId);
      if (timed.has(s.id) || boarding.has(s.id) || !pair) continue; // boards only at its own stops
      boarding.set(s.id, pair);
      found.push(s);
    }
  }
  return { schedules: found, boarding };
}

/** Coordinate search: see the module comment. `maxDistanceKm` is clamped to 1..200. */
export async function searchTripsGeo(
  from: LatLon,
  to: LatLon,
  maxDistanceKm: number,
  opts: SearchOptions,
): Promise<TripSearchResponse> {
  const max = Math.min(Math.max(maxDistanceKm, 1), 200);
  const { schedules: found, boarding } = await boardingSchedules(from, to, max);

  // Active routes only.
  const db = await getDb();
  const routeRows: RouteRow[] = await db
    .select()
    .from(routes)
    .where(
      and(
        eq(routes.status, "active"),
        inList(routes.id, [...new Set(found.map((s) => s.routeId))]),
      ),
    );
  const routesById = new Map(routeRows.map((r) => [r.id, r]));
  const active = found.filter((s) => routesById.has(s.routeId));

  const trips = await tripsOn(active, opts.date, opts.minSeats, GEO_TRIP_CAP);
  const candidates = toCandidates(trips, new Map(active.map((s) => [s.id, s])), routesById).flatMap(
    (c) => {
      const pair = boarding.get(c.schedule.id);
      return pair ? [{ ...c, pickup: pair[0], dropoff: pair[1] }] : [];
    },
  );
  return results(candidates, opts);
}
