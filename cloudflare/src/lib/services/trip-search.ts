/**
 * City search — port of `PublicService::search_trips` and the shared
 * `trip_search::results`: the trips on a date of the active routes from one
 * city to another, still to leave, filtered, sorted and paged on the server
 * so a filter sees every match, not just the page the browser has loaded.
 *
 * Read-first: trips are loaded before anything is filled; only schedules
 * with no trip on a date still to come are materialized, inline and within
 * a budget (see `trip-warmer.ts`).
 */
import { and, eq, or, sql } from "drizzle-orm";
import { getDb, inList } from "@/lib/db/client";
import { routes, schedules, tripSessions } from "@/lib/db/schema";
import { findCity, matchCitySlugs } from "@/lib/city-match";
import { ApiError } from "@/lib/auth/rbac";
import {
  buildCards,
  type Candidate,
  type RouteRow,
  type ScheduleRow,
  type TripRow,
} from "./trip-cards";
import { onSale } from "./public-format";
import {
  boardingMinutes,
  emptyResults,
  pageResults,
  type TripSearchResponse,
} from "./trip-results";
import type { SearchOptions } from "./trip-search-options";
import { localToday } from "./trip-time";
import { fillInline, scheduleRunsOn } from "./trip-warmer";

/** Most trips of one day a city search considers. */
const CITY_TRIP_CAP = 500;
/** Most routes a city search considers. */
const ROUTE_CAP = 1000;

/** Most trips of one day a coordinate search considers. */
export const GEO_TRIP_CAP = 1000;

/**
 * Does `route` run from the searched origin to the searched destination?
 * By its endpoint cities whenever both it and the search name known cities;
 * by its name mentioning the origin before the destination otherwise.
 */
export function runsBetween(
  route: Pick<RouteRow, "name" | "startLocationId" | "endLocationId">,
  fromSlugs: string[],
  toSlugs: string[],
  fromLower: string,
  toLower: string,
): boolean {
  const known = (slug: string) => findCity(slug) !== null;
  if (
    fromSlugs.length > 0 &&
    toSlugs.length > 0 &&
    known(route.startLocationId) &&
    known(route.endLocationId)
  ) {
    return fromSlugs.includes(route.startLocationId) && toSlugs.includes(route.endLocationId);
  }
  const name = route.name.toLowerCase();
  const a = name.indexOf(fromLower);
  const b = name.indexOf(toLower);
  return a >= 0 && b >= 0 && a < b;
}

/**
 * Active routes matching a from/to query: the route name holds both
 * (case-insensitive substring), or — when both sides resolved to cities —
 * its endpoints are those cities (Rust `search_active_routes`).
 */
async function searchActiveRoutes(
  fromLower: string,
  toLower: string,
  fromSlugs: string[],
  toSlugs: string[],
): Promise<RouteRow[]> {
  const db = await getDb();
  const byName = and(
    sql`LOWER(${routes.name}) LIKE ${`%${fromLower}%`}`,
    sql`LOWER(${routes.name}) LIKE ${`%${toLower}%`}`,
  );
  const byCity =
    fromSlugs.length > 0 && toSlugs.length > 0
      ? and(inList(routes.startLocationId, fromSlugs), inList(routes.endLocationId, toSlugs))
      : undefined;
  return db
    .select()
    .from(routes)
    .where(and(eq(routes.status, "active"), or(byName, byCity)))
    .limit(ROUTE_CAP);
}

/**
 * Trips on `date` for `candidates` with at least `minSeats` left: the rows
 * the warmer created, after filling any gap inline. Gaps are judged on the
 * trips found — a sold-out trip exists and is not a gap to fill.
 */
export async function tripsOn(
  candidates: ScheduleRow[],
  date: string,
  minSeats: number,
  cap: number,
): Promise<TripRow[]> {
  if (candidates.length === 0) return [];
  const db = await getDb();
  const ids = candidates.map((s) => s.id);
  const load = () =>
    db
      .select()
      .from(tripSessions)
      .where(
        and(
          inList(tripSessions.scheduleId, ids),
          eq(tripSessions.departureDate, date),
          eq(tripSessions.status, "scheduled"),
        ),
      )
      .limit(cap);
  let trips = await load();
  if (date >= localToday()) {
    const have = new Set(trips.map((t) => t.scheduleId));
    const missing = candidates.filter((s) => scheduleRunsOn(s, date) && !have.has(s.id));
    if (missing.length > 0) {
      await fillInline(missing, date);
      trips = await load();
    }
  }
  return trips.filter((t) => t.availableSeats >= minSeats);
}

/** Cards, facets, filters, sort and page for the trips a search found (Rust `trip_search::results`). */
export async function results(
  candidates: Candidate[],
  opts: SearchOptions,
): Promise<TripSearchResponse> {
  const sellable = candidates
    .filter((c) => onSale(c.trip, c.schedule))
    .filter(
      (c) =>
        opts.departAfter === null ||
        boardingMinutes(c.schedule.departureTime, c.pickup?.time) >= opts.departAfter,
    );
  if (sellable.length === 0) return emptyResults(opts);
  return pageResults(await buildCards(sellable), opts);
}

/** Trips of the schedules, joined to their schedule and route. */
export function toCandidates(
  trips: TripRow[],
  schedulesById: Map<string, ScheduleRow>,
  routesById: Map<string, RouteRow>,
): Candidate[] {
  return trips.flatMap((trip) => {
    const schedule = schedulesById.get(trip.scheduleId);
    const route = schedule && routesById.get(schedule.routeId);
    return schedule && route ? [{ trip, schedule, route }] : [];
  });
}

/** City search from `from` to `to` (city names; accents and aliases like "Sài Gòn" resolved). */
export async function searchTrips(
  from: string,
  to: string,
  opts: SearchOptions,
): Promise<TripSearchResponse> {
  from = from.trim();
  to = to.trim();
  if (!from) throw new ApiError(400, "validation", "missing departure location (from)");
  if (!to) throw new ApiError(400, "validation", "missing arrival location (to)");
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();
  const fromSlugs = matchCitySlugs(from);
  const toSlugs = matchCitySlugs(to);
  const found = (await searchActiveRoutes(fromLower, toLower, fromSlugs, toSlugs)).filter((r) =>
    runsBetween(r, fromSlugs, toSlugs, fromLower, toLower),
  );
  if (found.length === 0) return results([], opts);

  const db = await getDb();
  const scheduleRows = await db
    .select()
    .from(schedules)
    .where(
      inList(
        schedules.routeId,
        found.map((r) => r.id),
      ),
    );
  const trips = await tripsOn(scheduleRows, opts.date, opts.minSeats, CITY_TRIP_CAP);
  return results(
    toCandidates(
      trips,
      new Map(scheduleRows.map((s) => [s.id, s])),
      new Map(found.map((r) => [r.id, r])),
    ),
    opts,
  );
}
