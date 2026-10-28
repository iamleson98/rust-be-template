/**
 * Result cards from the trips a search found — the loading half of
 * `trip_search::build`: a fixed handful of batched, indexed queries whatever
 * the number of matches (no per-trip queries). Seat prices come from the
 * seat rows of trips someone opened and from the fare table otherwise
 * (seats are created on demand — see `trip-warmer.ts`).
 */
import { and, asc, eq, min, max } from "drizzle-orm";
import { getDb, inList } from "@/lib/db/client";
import {
  brands,
  busLayouts,
  routes,
  scheduleFares,
  schedulePoints,
  schedules,
  seatInventory,
  seats,
  tripSessions,
  vehicleTypes,
} from "@/lib/db/schema";
import { findCity } from "@/lib/city-match";
import { childPolicyOf, classOf, fareOf, fareTable, type FareTable } from "./fares";
import {
  arrivalIso,
  departureIso,
  parseAmenities,
  resolveVehicleType,
  standardChildPrice,
  type VehicleTypeRow,
} from "./public-format";
import { boardingMinutes, type Built, type TripCard, type TripStopMatch } from "./trip-results";

export type TripRow = typeof tripSessions.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type RouteRow = typeof routes.$inferSelect;
type BrandRow = typeof brands.$inferSelect;
type LayoutRow = typeof busLayouts.$inferSelect;

/** A trip a search found, with where the customer boards and leaves it (coordinate search). */
export interface Candidate {
  trip: TripRow;
  schedule: ScheduleRow;
  route: RouteRow;
  pickup?: TripStopMatch;
  dropoff?: TripStopMatch;
}

const unique = <T>(values: Iterable<T | null | undefined>): T[] => [
  ...new Set([...values].filter((v): v is T => v != null)),
];

const keyed = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/** Everything the cards of one search need beyond the trips themselves. */
interface CardData {
  brands: Map<string, BrandRow>;
  layouts: Map<string, LayoutRow>;
  vehicleTypes: Map<string, VehicleTypeRow>;
  /** Arrival `HH:MM` of each timetable's last timed stop. */
  arrivals: Map<string, string>;
  /** Cheapest and dearest seat for sale on trips whose seats exist. */
  forSale: Map<string, [number, number]>;
  fares: Map<string, FareTable>;
  /** The seat classes of each layout. */
  classes: Map<string, Set<string>>;
}

async function loadCardData(candidates: Candidate[]): Promise<CardData> {
  const db = await getDb();
  const scheduleIds = unique(candidates.map((c) => c.schedule.id));
  const layoutIds = unique(candidates.map((c) => c.schedule.busLayoutId));
  const typeIds = unique(candidates.map((c) => c.schedule.vehicleTypeId));
  const brandIds = unique(candidates.map((c) => c.route.brandId));
  const tripIds = candidates.map((c) => c.trip.id);

  const [brandRows, layoutRows, typeRows, points, ranges, fareRows, seatClasses] =
    await Promise.all([
      db.select().from(brands).where(inList(brands.id, brandIds)),
      db.select().from(busLayouts).where(inList(busLayouts.id, layoutIds)),
      db
        .select({ id: vehicleTypes.id, code: vehicleTypes.code, label: vehicleTypes.label })
        .from(vehicleTypes)
        .where(inList(vehicleTypes.id, typeIds)),
      db
        .select({ scheduleId: schedulePoints.scheduleId, arrivalTime: schedulePoints.arrivalTime })
        .from(schedulePoints)
        .where(inList(schedulePoints.scheduleId, scheduleIds))
        .orderBy(asc(schedulePoints.stopOrder)),
      db
        .select({
          tripId: seatInventory.tripSessionId,
          lo: min(seatInventory.finalPrice),
          hi: max(seatInventory.finalPrice),
        })
        .from(seatInventory)
        .where(
          and(inList(seatInventory.tripSessionId, tripIds), eq(seatInventory.status, "available")),
        )
        .groupBy(seatInventory.tripSessionId),
      db.select().from(scheduleFares).where(inList(scheduleFares.scheduleId, scheduleIds)),
      db
        .selectDistinct({ layoutId: seats.busLayoutId, seatClass: seats.seatClass })
        .from(seats)
        .where(inList(seats.busLayoutId, layoutIds)),
    ]);

  const arrivals = new Map<string, string>();
  for (const p of points) if (p.arrivalTime) arrivals.set(p.scheduleId, p.arrivalTime);

  const classes = new Map<string, Set<string>>();
  for (const s of seatClasses) {
    const set = classes.get(s.layoutId) ?? new Set<string>();
    set.add(classOf(s));
    classes.set(s.layoutId, set);
  }

  return {
    brands: keyed(brandRows),
    layouts: keyed(layoutRows),
    vehicleTypes: keyed(typeRows),
    arrivals,
    forSale: new Map(ranges.map((r) => [r.tripId, [r.lo ?? 0, r.hi ?? 0]])),
    fares: new Map(
      candidates.map(({ schedule: s }) => [
        s.id,
        fareTable(
          s,
          fareRows.filter((f) => f.scheduleId === s.id),
        ),
      ]),
    ),
    classes,
  };
}

/** The price range of a trip nobody opened: its layout's seat classes at the schedule's fares. */
function fareRange(s: ScheduleRow, data: CardData): [number, number] {
  const table = data.fares.get(s.id);
  const prices = [...(s.busLayoutId ? (data.classes.get(s.busLayoutId) ?? []) : [])].map((cls) =>
    table ? fareOf(table, cls).adult : s.basePriceAdult,
  );
  return prices.length > 0
    ? [Math.min(...prices), Math.max(...prices)]
    : [s.basePriceAdult, s.basePriceAdult];
}

function toBuilt(c: Candidate, data: CardData): Built {
  const { trip, schedule: s, route: r, pickup, dropoff } = c;
  const brand = r.brandId ? data.brands.get(r.brandId) : undefined;
  const layout = s.busLayoutId ? data.layouts.get(s.busLayoutId) : undefined;
  const [vehicleType, vehicleTypeLabel] = resolveVehicleType(
    s.vehicleTypeId,
    layout?.vehicleType ?? null,
    data.vehicleTypes,
  );
  const [minPrice, maxPrice] = data.forSale.get(trip.id) ?? fareRange(s, data);
  const from = findCity(r.startLocationId);
  const to = findCity(r.endLocationId);
  const arrives = data.arrivals.get(s.id);
  const card: TripCard = {
    tripId: trip.id,
    scheduleId: s.id,
    departureDate: trip.departureDate,
    status: trip.status,
    availableSeats: trip.availableSeats,
    totalSeats: trip.totalSeats,
    routeId: r.id,
    routeName: r.name,
    brandId: r.brandId ?? undefined,
    brandName: brand?.name ?? "",
    brandSlug: brand?.slug ?? "",
    brandLogo: brand?.logoUrl ?? undefined,
    brandRating: brand?.rating ?? undefined,
    fromName: from?.name ?? "",
    fromLat: from?.lat ?? 0,
    fromLon: from?.lon ?? 0,
    toName: to?.name ?? "",
    toLat: to?.lat ?? 0,
    toLon: to?.lon ?? 0,
    departureTime: s.departureTime,
    departureAt: departureIso(trip.departureDate, s.departureTime) ?? undefined,
    arrivalAt: arrives
      ? (arrivalIso(trip.departureDate, s.departureTime, arrives) ?? undefined)
      : undefined,
    busLayoutId: s.busLayoutId ?? undefined,
    minPrice,
    maxPrice,
    priceAdult: s.basePriceAdult,
    priceChild: standardChildPrice(s, childPolicyOf(brand)),
    vehicleType,
    vehicleTypeLabel,
    capacity: layout?.totalSeats ?? undefined,
    amenities: parseAmenities(s.amenities),
    pickup,
    dropoff,
  };
  return {
    card,
    boardsAt: boardingMinutes(s.departureTime, pickup?.time),
    distanceKm: pickup && dropoff ? pickup.distanceKm + dropoff.distanceKm : null,
  };
}

/** The cards (and what sorting needs about them) of these candidates. */
export async function buildCards(candidates: Candidate[]): Promise<Built[]> {
  if (candidates.length === 0) return [];
  const data = await loadCardData(candidates);
  return candidates.map((c) => toBuilt(c, data));
}
