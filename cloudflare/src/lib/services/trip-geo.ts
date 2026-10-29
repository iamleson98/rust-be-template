/**
 * Coordinate search — the search for places picked from the place search or
 * the map. A trip is found when
 * - its route runs between the cities the two places are in (the city
 *   search's routes), or
 * - it stops within a distance of both places, in that order (a route
 *   passing through, or one filed under a neighbouring city),
 * and each trip carries the pickup and drop-off stops nearest the places,
 * so the default order puts the trips that serve them best first. A trip
 * between the cities whose stops have no coordinates is still found, after
 * the measured ones.
 *
 * A schedule with a timetable of its own is matched on ITS stops (with the
 * time the bus is there); one without on its route's pickup points. Stops
 * are found through the `(lat, lon)` columns inside a box around each
 * place, then measured exactly.
 */
import { and, between, eq, isNotNull, or, type SQL, type SQLWrapper } from "drizzle-orm";
import { getDb, inList } from "@/lib/db/client";
import { addresses, pickupPoints, routes, schedulePoints, schedules } from "@/lib/db/schema";
import { results, routesBetween, toCandidates, tripsOn, GEO_TRIP_CAP } from "./trip-search";
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

/**
 * Timetable stops (with the time the bus is there) matching `where`, by
 * schedule. Every schedule with a timetable gets an entry, even when none
 * of its stops has coordinates.
 */
async function scheduleStops(where: SQL | undefined): Promise<Map<string, StopHit[]>> {
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
    .where(where);
  const out = new Map<string, StopHit[]>();
  for (const r of rows) {
    const hits = out.get(r.scheduleId) ?? [];
    out.set(r.scheduleId, hits);
    if (r.lat != null && r.lon != null) {
      hits.push({
        order: r.order,
        name: r.name,
        time: r.time || undefined,
        lat: r.lat,
        lon: r.lon,
      });
    }
  }
  return out;
}

/** Pickup points with coordinates of active routes matching `where`, by route. */
async function routeStops(where: SQL | undefined): Promise<Map<string, StopHit[]>> {
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
        where,
      ),
    );
  const out = new Map<string, StopHit[]>();
  for (const r of rows) {
    if (r.lat == null || r.lon == null) continue;
    out.set(r.routeId, [
      ...(out.get(r.routeId) ?? []),
      { order: r.order, name: r.name ?? "", lat: r.lat, lon: r.lon },
    ]);
  }
  return out;
}

/** The cities the searched places are in, as the place search named them. */
export interface PlaceCities {
  from: string;
  to: string;
}

/**
 * The schedules to search and where the customer boards each: null when
 * the schedule runs between the searched cities but no stop of it has
 * coordinates to measure.
 */
async function boardingSchedules(
  from: LatLon,
  to: LatLon,
  max: number,
  cities: PlaceCities | null,
): Promise<{ schedules: ScheduleRow[]; boarding: Map<string, StopPair | null> }> {
  const db = await getDb();
  const boxes = [geoBox(from, max), geoBox(to, max)];

  // Stops near both places (a schedule's own, or its route's for a schedule
  // without a timetable), and the routes between the two cities.
  const [nearSchedules, nearRoutes, cityRoutes] = await Promise.all([
    scheduleStops(inside(boxes, addresses.lat, addresses.lon)),
    routeStops(inside(boxes, pickupPoints.lat, pickupPoints.lon)),
    cities ? routesBetween(cities.from, cities.to) : Promise.resolve([]),
  ]);
  const near = pairsOf(nearSchedules, from, to, max);
  const nearRoute = pairsOf(nearRoutes, from, to, max);
  const cityRouteIds = new Set(cityRoutes.map((r) => r.id));
  const routeIds = [...new Set([...nearRoute.keys(), ...cityRouteIds])];
  if (near.size === 0 && routeIds.length === 0) return { schedules: [], boarding: new Map() };

  const found = await db
    .select()
    .from(schedules)
    .where(or(inList(schedules.id, [...near.keys()]), inList(schedules.routeId, routeIds)));
  // Which of the others have a timetable (they board only at its stops),
  // and every stop of the city routes, however far.
  const others = found.filter((s) => !near.has(s.id));
  const [timetables, cityPoints] = await Promise.all([
    others.length > 0
      ? scheduleStops(
          inList(
            schedulePoints.scheduleId,
            others.map((s) => s.id),
          ),
        )
      : new Map<string, StopHit[]>(),
    cityRouteIds.size > 0
      ? routeStops(inList(pickupPoints.routeId, [...cityRouteIds]))
      : new Map<string, StopHit[]>(),
  ]);

  const boarding = new Map<string, StopPair | null>(near);
  for (const s of others) {
    const onCityRoute = cityRouteIds.has(s.routeId);
    const own = timetables.get(s.id);
    const routePair = nearRoute.get(s.routeId);
    if (own) {
      // Its own stops were already measured against the distance; a schedule
      // between the cities is kept with its nearest stops, however far.
      if (onCityRoute) boarding.set(s.id, nearestPair(own, from, to, Infinity));
    } else if (routePair) {
      boarding.set(s.id, routePair);
    } else if (onCityRoute) {
      boarding.set(s.id, nearestPair(cityPoints.get(s.routeId) ?? [], from, to, Infinity));
    }
  }
  return { schedules: found.filter((s) => boarding.has(s.id)), boarding };
}

/**
 * Coordinate search: see the module comment. `maxDistanceKm` is clamped to
 * 1..200; with `cities`, every trip between them is kept too.
 */
export async function searchTripsGeo(
  from: LatLon,
  to: LatLon,
  maxDistanceKm: number,
  opts: SearchOptions,
  cities: PlaceCities | null = null,
): Promise<TripSearchResponse> {
  const max = Math.min(Math.max(maxDistanceKm, 1), 200);
  const { schedules: found, boarding } = await boardingSchedules(from, to, max, cities);
  if (found.length === 0) return results([], opts);

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
  const candidates = toCandidates(trips, new Map(active.map((s) => [s.id, s])), routesById).map(
    (c) => {
      const pair = boarding.get(c.schedule.id);
      return pair ? { ...c, pickup: pair[0], dropoff: pair[1] } : c;
    },
  );
  return results(candidates, opts);
}
