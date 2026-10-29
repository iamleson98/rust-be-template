/**
 * `GET /api/trips/{id}` — port of `PublicService::trip_detail`: the trip
 * with its route, brand, endpoints, bus layout, pricing and per-class fares,
 * amenities, stops, timetable and the deck/row/col seat map with live
 * status. Opening a trip creates its seat rows if it has none yet.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb, inList } from "@/lib/db/client";
import {
  addresses,
  brands,
  busLayouts,
  routes,
  schedulePoints,
  scheduleFares,
  schedules,
  seatInventory,
  seats,
  tripSessions,
  vehicleTypes,
} from "@/lib/db/schema";
import { ApiError } from "@/lib/auth/rbac";
import { findCity } from "@/lib/city-match";
import {
  childPolicyOf,
  childPrice,
  classOf,
  fareOf,
  fareTable,
  type ChildPolicy,
  type Fare,
} from "./fares";
import {
  amenityLabel,
  arrivalIso,
  departureIso,
  onSale,
  parseAmenities,
  resolveVehicleType,
  standardChildPrice,
} from "./public-format";
import { isSellable, trustedPlan } from "./seat-plan";
import { tripStops } from "./trip-stops";
import { ensureSeats } from "./trip-warmer";

const notFound = (what: string) => new ApiError(404, "not-found", `${what} not found`);

/** The seats of one class on a trip, for the fare legend. */
interface FareSummary {
  fare: Fare;
  /** Cheapest seat for sale. */
  cheapestAvailable: number | null;
  cheapest: number;
  seats: number;
  available: number;
}

/** One entry per seat class on the trip, cheapest first (Rust `trip_fares`). */
function tripFares(classes: Map<string, FareSummary>, policy: ChildPolicy | null) {
  return [...classes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([seatClass, s]) => {
      const priceAdult = s.cheapestAvailable ?? s.cheapest;
      return {
        seatClass,
        priceAdult,
        priceChild: childPrice(priceAdult, s.fare, policy) ?? undefined,
        seats: s.seats,
        available: s.available,
      };
    })
    .sort((a, b) => a.priceAdult - b.priceAdult);
}

export async function tripDetail(tripId: string) {
  const db = await getDb();
  const trip = (await db.select().from(tripSessions).where(eq(tripSessions.id, tripId)))[0];
  if (!trip) throw notFound("trip");
  const schedule = (await db.select().from(schedules).where(eq(schedules.id, trip.scheduleId)))[0];
  if (!schedule) throw notFound("schedule");
  const route = (await db.select().from(routes).where(eq(routes.id, schedule.routeId)))[0];
  if (!route) throw notFound("route");

  const [brand, layout, vehicleType, pickups, timetable] = await Promise.all([
    route.brandId
      ? db
          .select()
          .from(brands)
          .where(eq(brands.id, route.brandId))
          .then((r) => r[0])
      : undefined,
    schedule.busLayoutId
      ? db
          .select()
          .from(busLayouts)
          .where(eq(busLayouts.id, schedule.busLayoutId))
          .then((r) => r[0])
      : undefined,
    schedule.vehicleTypeId
      ? db
          .select({ id: vehicleTypes.id, code: vehicleTypes.code, label: vehicleTypes.label })
          .from(vehicleTypes)
          .where(eq(vehicleTypes.id, schedule.vehicleTypeId))
          .then((r) => r[0])
      : undefined,
    tripStops(route.id, schedule.id),
    db
      .select({
        id: schedulePoints.id,
        stopOrder: schedulePoints.stopOrder,
        kind: schedulePoints.kind,
        arrivalTime: schedulePoints.arrivalTime,
        name: addresses.name,
        address: addresses.address,
        lat: addresses.lat,
        lon: addresses.lon,
        cityId: addresses.cityId,
      })
      .from(schedulePoints)
      .innerJoin(addresses, eq(addresses.id, schedulePoints.addressId))
      .where(eq(schedulePoints.scheduleId, schedule.id))
      .orderBy(asc(schedulePoints.stopOrder)),
  ]);

  // Seats are created when a trip is first opened.
  await ensureSeats(db, trip.id, schedule);
  const seatRows = schedule.busLayoutId
    ? await db
        .select()
        .from(seats)
        .where(eq(seats.busLayoutId, schedule.busLayoutId))
        .orderBy(asc(seats.floor), asc(seats.rowNum), asc(seats.colNum))
    : [];
  const inventory = new Map(
    (seatRows.length > 0
      ? await db
          .select()
          .from(seatInventory)
          .where(
            and(
              eq(seatInventory.tripSessionId, trip.id),
              inList(
                seatInventory.seatId,
                seatRows.map((s) => s.id),
              ),
            ),
          )
      : []
    ).map((i) => [i.seatId, i]),
  );

  // The saved floor plan (fixtures + what each seat physically is), trusted
  // only while it still matches the seat rows.
  const plan = layout ? trustedPlan(layout.layoutData, seatRows) : null;
  const kinds = new Map(
    (plan?.decks ?? []).flatMap((d, i) =>
      d.cells.flatMap((c) =>
        isSellable(c.kind) && c.label ? [[`${i + 1}|${c.label.trim().toLowerCase()}`, c.kind]] : [],
      ),
    ),
  );

  const fareRows = await db
    .select()
    .from(scheduleFares)
    .where(eq(scheduleFares.scheduleId, schedule.id));
  const table = fareTable(schedule, fareRows);
  const policy = childPolicyOf(brand);
  const classFares = new Map<string, FareSummary>();
  const decks = new Map<number, Map<number, unknown[]>>();
  for (const s of seatRows) {
    const cls = classOf(s);
    const fare = fareOf(table, cls);
    const inv = inventory.get(s.id);
    const status = inv?.status ?? "available";
    const price = inv?.finalPrice ?? fare.adult;
    const summary = classFares.get(cls) ?? {
      fare,
      cheapestAvailable: null,
      cheapest: Number.MAX_SAFE_INTEGER,
      seats: 0,
      available: 0,
    };
    summary.seats++;
    summary.cheapest = Math.min(summary.cheapest, price);
    if (status === "available") {
      summary.available++;
      summary.cheapestAvailable = Math.min(summary.cheapestAvailable ?? price, price);
    }
    classFares.set(cls, summary);

    const row = s.rowNum ?? 0;
    const rows = decks.get(s.floor) ?? new Map<number, unknown[]>();
    rows.set(row, [
      ...(rows.get(row) ?? []),
      {
        id: s.id,
        code: s.seatLabel,
        seatLabel: s.seatLabel,
        row,
        col: s.colNum ?? 0,
        deck: s.floor,
        seatClass: s.seatClass ?? undefined,
        kind: kinds.get(`${s.floor}|${s.seatLabel.trim().toLowerCase()}`),
        status,
        finalPrice: price,
        childPrice: childPrice(price, fare, policy) ?? undefined,
      },
    ]);
    decks.set(s.floor, rows);
  }

  const lastArrival = [...timetable].reverse().find((p) => p.arrivalTime)?.arrivalTime;
  const from = findCity(route.startLocationId);
  const to = findCity(route.endLocationId);
  const [vehicleTypeCode, vehicleTypeName] = resolveVehicleType(
    schedule.vehicleTypeId,
    layout?.vehicleType ?? null,
    new Map(vehicleType ? [[vehicleType.id, vehicleType]] : []),
  );

  return {
    trip: {
      id: trip.id,
      bookable: onSale(trip, schedule),
      departureDate: trip.departureDate,
      departureAt: departureIso(trip.departureDate, schedule.departureTime) ?? undefined,
      departureTime: schedule.departureTime,
      arrivalAt: lastArrival
        ? (arrivalIso(trip.departureDate, schedule.departureTime, lastArrival) ?? undefined)
        : undefined,
      status: trip.status,
      driverName: trip.driverName ?? undefined,
      totalSeats: trip.totalSeats,
      availableSeats: trip.availableSeats,
    },
    route: { id: route.id, name: route.name },
    brand: {
      id: route.brandId ?? undefined,
      name: brand?.name,
      slug: brand?.slug,
      logoUrl: brand?.logoUrl ?? undefined,
      rating: brand?.rating ?? undefined,
    },
    from: { cityId: from?.slug, name: from?.name, lat: from?.lat ?? 0, lon: from?.lon ?? 0 },
    to: { cityId: to?.slug, name: to?.name, lat: to?.lat ?? 0, lon: to?.lon ?? 0 },
    busLayout: {
      id: schedule.busLayoutId ?? undefined,
      name: layout?.name ?? undefined,
      capacity: layout?.totalSeats ?? null,
      vehicleType: vehicleTypeCode,
      vehicleTypeLabel: vehicleTypeName,
    },
    pricing: {
      basePriceAdult: schedule.basePriceAdult,
      basePriceChild: standardChildPrice(schedule, policy),
      fares: tripFares(classFares, policy),
      childFare: policy ?? undefined,
    },
    amenities: parseAmenities(schedule.amenities).map((key) => ({
      key,
      label: amenityLabel(key) || key,
    })),
    pickupPoints: pickups.map((s) => ({
      id: s.id,
      name: s.name,
      stopOrder: s.order,
      lat: s.lat ?? undefined,
      lon: s.lon ?? undefined,
      kind: s.kind ?? undefined,
      address: s.address ?? undefined,
    })),
    schedulePoints: timetable.flatMap((p) =>
      p.lat == null || p.lon == null
        ? []
        : [
            {
              id: p.id,
              stopOrder: p.stopOrder,
              kind: p.kind,
              arrivalTime: p.arrivalTime ?? undefined,
              name: p.name,
              address: p.address ?? undefined,
              cityId: p.cityId ?? undefined,
              lat: p.lat,
              lon: p.lon,
            },
          ],
    ),
    seatMap: {
      decks: [...decks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([deck, rows]) => {
          const frame = plan?.decks[deck - 1];
          return {
            deck,
            plan: frame && {
              name: frame.name ?? undefined,
              rows: frame.rows,
              cols: frame.cols,
              fixtures: frame.cells.filter((c) => !isSellable(c.kind)),
            },
            rows: [...rows.entries()]
              .sort(([a], [b]) => a - b)
              .map(([row, rowSeats]) => ({ row, seats: rowSeats })),
          };
        }),
    },
  };
}
