/**
 * A brand's public page in one read — `GET /api/brands/{slug}/profile`.
 *
 * Everything the page shows comes from here: who the brand is, where it
 * has offices and stops, the routes it runs with their timetables, and the
 * trips about to leave. One request replaces the four the page used to make
 * (brand, routes, review stats, then reviews), and the answer is shared per
 * colo through the Cache API (`edge-guard.ts`), so a busy brand page costs
 * the Free plan's D1 about seven small indexed reads a minute, not seven
 * per visitor.
 *
 * Every figure is read, never estimated: a route with no schedule has no
 * price, a brand with no review has no rating.
 */
import { and, asc, count, eq, gte, lte } from "drizzle-orm";
import { getDb, inList } from "@/lib/db/client";
import { addresses, reviews, routes, schedules, tripSessions, vehicleTypes } from "@/lib/db/schema";
import { withRetry } from "@/lib/db/retry";
import { findCity } from "@/lib/city-match";
import { endpointNames, getBrandBySlug } from "./lookups";
import { onSale } from "./public-format";
import { localToday } from "./trip-time";

/** Days of departures the page lists, today included. */
export const UPCOMING_DAYS = 3;
/** Most trips the page lists. */
export const UPCOMING_TRIP_CAP = 40;
/** Most locations the page lists. */
const LOCATION_CAP = 60;

const DAY_MS = 86_400_000;

export interface ProfileSchedule {
  id: string;
  /** `HH:MM`. */
  departureTime: string;
  /** Weekdays it runs, Monday first, as `1`/`0`; null when it runs every day. */
  daysOfWeek: string | null;
  vehicleType: string | null;
  priceAdult: number;
}

export interface ProfileRoute {
  id: string;
  name: string;
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  /** Lowest adult base price across its schedules; absent while it has none. */
  priceFrom: number | null;
  schedules: ProfileSchedule[];
}

export interface ProfileTrip {
  tripId: string;
  routeId: string;
  /** `YYYY-MM-DD`, Vietnam. */
  date: string;
  /** `HH:MM`. */
  departureTime: string;
  availableSeats: number;
  totalSeats: number;
  vehicleType: string | null;
  priceAdult: number;
}

export interface ProfileLocation {
  id: string;
  name: string;
  address: string | null;
  /** The city's display name. */
  city: string | null;
  lat: number | null;
  lon: number | null;
}

export interface BrandProfile {
  brand: NonNullable<Awaited<ReturnType<typeof getBrandBySlug>>> & { reviewCount: number };
  /** At most {@link LOCATION_CAP}, by city then name. */
  locations: ProfileLocation[];
  routes: ProfileRoute[];
  trips: ProfileTrip[];
}

const dayAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The page of the active brand `slug`; null when there is none. */
export async function getBrandProfile(slug: string): Promise<BrandProfile | null> {
  const brand = await getBrandBySlug(slug);
  if (!brand) return null;
  const db = await getDb();
  const today = localToday();

  const [routeRows, locationRows, [reviewRow]] = await withRetry(() =>
    Promise.all([
      db
        .select()
        .from(routes)
        .where(and(eq(routes.brandId, brand.id), eq(routes.status, "active")))
        .orderBy(asc(routes.name)),
      db
        .select({
          id: addresses.id,
          name: addresses.name,
          address: addresses.address,
          province: addresses.province,
          lat: addresses.lat,
          lon: addresses.lon,
        })
        .from(addresses)
        .where(eq(addresses.brandId, brand.id))
        .orderBy(asc(addresses.province), asc(addresses.name))
        .limit(LOCATION_CAP),
      db
        .select({ n: count() })
        .from(reviews)
        .where(and(eq(reviews.brandId, brand.id), eq(reviews.status, "approved"))),
    ]),
  );

  const scheduleRows =
    routeRows.length === 0
      ? []
      : await withRetry(() =>
          db
            .select()
            .from(schedules)
            .where(
              inList(
                schedules.routeId,
                routeRows.map((r) => r.id),
              ),
            )
            .orderBy(asc(schedules.departureTime)),
        );
  // A schedule whose window has closed never departs again.
  const live = scheduleRows.filter((s) => !s.effectiveTo || s.effectiveTo >= today);

  const [typeRows, tripRows] =
    live.length === 0
      ? [[], []]
      : await withRetry(() =>
          Promise.all([
            db
              .select({ id: vehicleTypes.id, label: vehicleTypes.label })
              .from(vehicleTypes)
              .where(
                inList(
                  vehicleTypes.id,
                  live.flatMap((s) => (s.vehicleTypeId ? [s.vehicleTypeId] : [])),
                ),
              ),
            // The trips the warmer already made; this page never creates any.
            db
              .select()
              .from(tripSessions)
              .where(
                and(
                  inList(
                    tripSessions.scheduleId,
                    live.map((s) => s.id),
                  ),
                  gte(tripSessions.departureDate, today),
                  lte(tripSessions.departureDate, dayAfter(today, UPCOMING_DAYS - 1)),
                  eq(tripSessions.status, "scheduled"),
                ),
              )
              .orderBy(asc(tripSessions.departureDate)),
          ]),
        );

  const typeLabel = new Map(typeRows.map((t) => [t.id, t.label]));
  const scheduleById = new Map(live.map((s) => [s.id, s]));

  const profileRoutes: ProfileRoute[] = routeRows.map((r) => {
    const names = endpointNames(r);
    const from = findCity(r.startLocationId);
    const to = findCity(r.endLocationId);
    const own = live.filter((s) => s.routeId === r.id);
    return {
      id: r.id,
      name: r.name,
      from: { name: names.from, lat: from?.lat ?? 0, lon: from?.lon ?? 0 },
      to: { name: names.to, lat: to?.lat ?? 0, lon: to?.lon ?? 0 },
      priceFrom: own.length ? Math.min(...own.map((s) => s.basePriceAdult)) : null,
      schedules: own.map((s) => ({
        id: s.id,
        departureTime: s.departureTime,
        daysOfWeek: s.daysOfWeek && /^[01]{7}$/.test(s.daysOfWeek) ? s.daysOfWeek : null,
        vehicleType: s.vehicleTypeId ? (typeLabel.get(s.vehicleTypeId) ?? null) : null,
        priceAdult: s.basePriceAdult,
      })),
    };
  });

  const now = new Date();
  const trips = tripRows
    .flatMap((trip) => {
      const schedule = scheduleById.get(trip.scheduleId);
      if (!schedule || !onSale(trip, schedule, now)) return [];
      return [
        {
          tripId: trip.id,
          routeId: schedule.routeId,
          date: trip.departureDate,
          departureTime: schedule.departureTime,
          availableSeats: trip.availableSeats,
          totalSeats: trip.totalSeats,
          vehicleType: schedule.vehicleTypeId
            ? (typeLabel.get(schedule.vehicleTypeId) ?? null)
            : null,
          priceAdult: schedule.basePriceAdult,
        },
      ];
    })
    .sort((a, b) => (a.date + a.departureTime).localeCompare(b.date + b.departureTime))
    .slice(0, UPCOMING_TRIP_CAP);

  return {
    brand: { ...brand, reviewCount: Number(reviewRow?.n ?? 0) },
    // SQLite sorts by bytes, which puts "Hà Nội" after "Huế": order by Vietnamese collation here.
    locations: locationRows
      .map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        city: l.province,
        lat: l.lat,
        lon: l.lon,
      }))
      .sort(
        (a, b) =>
          (a.city ?? "").localeCompare(b.city ?? "", "vi") || a.name.localeCompare(b.name, "vi"),
      ),
    routes: profileRoutes,
    trips,
  };
}
