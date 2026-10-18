import { getDb } from "@/lib/db/client";
import { and, asc, eq, sql } from "drizzle-orm";
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
import { handleRouteError, err } from "@/lib/api";
import {
  amenityLabel,
  childPolicyOf,
  childPrice,
  classOf,
  computeArrivalIso,
  computeIsoTimestamps,
  findCity,
  parseAmenities,
  resolveVehicleType,
  standardChildPrice,
  vehicleTypeCatalog,
} from "@/lib/services/trip-search";

/**
 * `GET /api/trips/{id}` — the full trip detail (Rust `TripDetail`):
 * trip core, route, brand, endpoints, bus layout, pricing + per-class
 * fares, amenities, route pickup points, the schedule's ordered stops
 * with arrival times, and the deck/row/col seat map with live status.
 * Every query below is a typed drizzle builder — column names are
 * compiler-checked end to end.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  try {
    const { tripId } = await ctx.params;
    const db = await getDb();

    const t = (
      await db
        .select({
          trip: tripSessions,
          schedule: schedules,
          route: routes,
          brand: brands,
          vtCode: vehicleTypes.code,
          vtLabel: vehicleTypes.label,
          layout: busLayouts,
        })
        .from(tripSessions)
        .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
        .innerJoin(routes, eq(routes.id, schedules.routeId))
        .leftJoin(brands, eq(brands.id, routes.brandId))
        .leftJoin(vehicleTypes, eq(vehicleTypes.id, schedules.vehicleTypeId))
        .leftJoin(busLayouts, eq(busLayouts.id, schedules.busLayoutId))
        .where(eq(tripSessions.id, tripId))
        .limit(1)
    )[0];
    if (!t) return err(404, "not-found", "Trip not found");

    const { trip, schedule, route, brand, layout } = t;
    const layoutId = schedule.busLayoutId;

    // ── Seat rows + live inventory (LEFT JOIN, COALESCE for pre-inventory
    //    trips that have not materialized seat_inventory yet) ─────────
    const seatRows = layoutId
      ? await db
          .select({
            id: seats.id,
            seatLabel: seats.seatLabel,
            seatClass: seats.seatClass,
            rowNum: seats.rowNum,
            colNum: seats.colNum,
            floor: seats.floor,
            status: sql<string>`COALESCE(${seatInventory.status}, 'available')`,
            finalPrice: seatInventory.finalPrice,
          })
          .from(seats)
          .leftJoin(
            seatInventory,
            and(eq(seatInventory.seatId, seats.id), eq(seatInventory.tripSessionId, tripId)),
          )
          .where(eq(seats.busLayoutId, layoutId))
          .orderBy(asc(seats.floor), asc(seats.rowNum), asc(seats.colNum))
      : [];

    // ── Fare table (per seat class) ─────────────────────────────
    const fareRows = await db
      .select({
        seatClass: scheduleFares.seatClass,
        priceAdult: scheduleFares.priceAdult,
        priceChild: scheduleFares.priceChild,
      })
      .from(scheduleFares)
      .where(eq(scheduleFares.scheduleId, schedule.id));
    const fareByClass = new Map(
      fareRows.map((f) => [classOf(f.seatClass), { adult: f.priceAdult, child: f.priceChild }]),
    );
    const stdFare = { adult: schedule.basePriceAdult, child: schedule.basePriceChild };
    const fareOf = (seatClass: string | null): { adult: number; child: number | null } =>
      fareByClass.get(classOf(seatClass)) ?? stdFare;

    const policy = childPolicyOf({
      child_max_age: brand?.childMaxAge ?? null,
      child_discount_amount: brand?.childDiscountAmount ?? null,
    });

    // ── Per-class fare summary (Rust `trip_fares`) ───────────────
    interface SeatOut {
      id: string;
      code: string;
      seatLabel: string;
      row: number;
      col: number;
      deck: number;
      seatClass: string | undefined;
      status: string;
      finalPrice: number;
      /** Undefined when the brand has no child fare policy. */
      childPrice: number | undefined;
    }
    interface FareSummary {
      seatClass: string;
      fareAdult: number;
      fareChild: number | null;
      cheapestAvailable: number | null;
      cheapest: number;
      seats: number;
      available: number;
    }
    const classFares = new Map<string, FareSummary>();
    const decks = new Map<number, Map<number, SeatOut[]>>();
    for (const s of seatRows) {
      const seatClass = classOf(s.seatClass);
      const fare = fareOf(s.seatClass);
      const price = s.finalPrice ?? fare.adult;
      const available = s.status === "available";
      const cur =
        classFares.get(seatClass) ??
        ({
          seatClass,
          fareAdult: fare.adult,
          fareChild: fare.child,
          cheapestAvailable: null,
          cheapest: Number.MAX_SAFE_INTEGER,
          seats: 0,
          available: 0,
        } satisfies FareSummary);
      cur.seats++;
      cur.cheapest = Math.min(cur.cheapest, price);
      if (available) {
        cur.available++;
        cur.cheapestAvailable = Math.min(cur.cheapestAvailable ?? price, price);
      }
      classFares.set(seatClass, cur);

      const deck = s.floor;
      const row = s.rowNum ?? 0;
      let rowsMap = decks.get(deck);
      if (rowsMap === undefined) {
        rowsMap = new Map();
        decks.set(deck, rowsMap);
      }
      let rowSeats = rowsMap.get(row);
      if (rowSeats === undefined) {
        rowSeats = [];
        rowsMap.set(row, rowSeats);
      }
      rowSeats.push({
        id: s.id,
        code: s.seatLabel,
        seatLabel: s.seatLabel,
        row,
        col: s.colNum ?? 0,
        deck,
        seatClass: s.seatClass ?? undefined,
        status: s.status,
        finalPrice: price,
        childPrice: childPrice(price, { adult: fare.adult, child: fare.child }, policy),
      });
    }
    const fares = [...classFares.values()]
      .map((f) => ({
        seatClass: f.seatClass,
        priceAdult: f.cheapestAvailable ?? f.cheapest,
        priceChild: childPrice(
          f.cheapestAvailable ?? f.cheapest,
          { adult: f.fareAdult, child: f.fareChild },
          policy,
        ),
        seats: f.seats,
        available: f.available,
      }))
      .sort((a, b) => a.priceAdult - b.priceAdult);

    // ── Pickup points (route-level) + schedule points (timetable) ─
    const pickups = await db
      .select({
        id: pickupPoints.id,
        name: pickupPoints.name,
        stopOrder: pickupPoints.stopOrder,
        lat: pickupPoints.lat,
        lon: pickupPoints.lon,
        kind: pickupPoints.kind,
        address: pickupPoints.address,
      })
      .from(pickupPoints)
      .where(eq(pickupPoints.routeId, route.id))
      .orderBy(asc(pickupPoints.stopOrder));
    const stops = await db
      .select({
        id: schedulePoints.id,
        stopOrder: schedulePoints.stopOrder,
        kind: schedulePoints.kind,
        arrivalTime: schedulePoints.arrivalTime,
        name: addresses.name,
        address: addresses.address,
        lat: addresses.lat,
        lon: addresses.lon,
      })
      .from(schedulePoints)
      .innerJoin(addresses, eq(addresses.id, schedulePoints.addressId))
      .where(eq(schedulePoints.scheduleId, schedule.id))
      .orderBy(asc(schedulePoints.stopOrder));

    // ── Times + bookable ─────────────────────────────────────────
    const departureAt =
      computeIsoTimestamps(trip.departureDate, schedule.departureTime) ?? undefined;
    const lastArrival = [...stops].reverse().find((p) => p.arrivalTime && p.arrivalTime !== "");
    const arrivalAt = lastArrival?.arrivalTime
      ? (computeArrivalIso(trip.departureDate, schedule.departureTime, lastArrival.arrivalTime) ??
        undefined)
      : undefined;
    const vnNow = new Date(Date.now() + 7 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowDate = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;
    const nowTime = `${pad(vnNow.getUTCHours())}:${pad(vnNow.getUTCMinutes())}`;
    const bookable =
      trip.status === "scheduled" &&
      (trip.departureDate > nowDate ||
        (trip.departureDate === nowDate && schedule.departureTime >= nowTime));

    const catalog = await vehicleTypeCatalog();
    const [vehicleType, vehicleTypeLabel] = resolveVehicleType(
      {
        vt_code: t.vtCode,
        vt_label: t.vtLabel,
        layout_vehicle_type: layout?.vehicleType ?? null,
      },
      catalog,
    );
    const from = findCity(route.startLocationId);
    const to = findCity(route.endLocationId);

    return Response.json({
      trip: {
        id: trip.id,
        bookable,
        departureDate: trip.departureDate,
        departureAt,
        departureTime: schedule.departureTime,
        arrivalAt,
        status: trip.status,
        driverName: trip.driverName ?? undefined,
        totalSeats: trip.totalSeats,
        availableSeats: trip.availableSeats,
      },
      route: { id: route.id, name: route.name },
      brand: brand
        ? {
            id: brand.id,
            name: brand.name,
            slug: brand.slug,
            logoUrl: brand.logoUrl,
            rating: brand.rating,
          }
        : {},
      from: { name: from?.name, lat: from?.lat ?? 0, lon: from?.lon ?? 0 },
      to: { name: to?.name, lat: to?.lat ?? 0, lon: to?.lon ?? 0 },
      busLayout: {
        id: layoutId ?? undefined,
        name: layout?.name ?? undefined,
        capacity: layout?.totalSeats ?? undefined,
        vehicleType,
        vehicleTypeLabel,
      },
      pricing: {
        basePriceAdult: schedule.basePriceAdult,
        basePriceChild: standardChildPrice(
          { base_price_adult: schedule.basePriceAdult, base_price_child: schedule.basePriceChild },
          policy,
        ),
        fares,
        childFare: policy ?? undefined,
      },
      amenities: parseAmenities(schedule.amenities).map((key) => ({
        key,
        label: amenityLabel(key) || key,
      })),
      pickupPoints: pickups.map((p) => ({
        id: p.id,
        name: p.name ?? undefined,
        stopOrder: p.stopOrder ?? undefined,
        lat: p.lat ?? undefined,
        lon: p.lon ?? undefined,
        kind: p.kind ?? undefined,
        address: p.address ?? undefined,
      })),
      schedulePoints: stops.map((p) => ({
        id: p.id,
        stopOrder: p.stopOrder,
        kind: p.kind,
        arrivalTime: p.arrivalTime || undefined,
        name: p.name,
        address: p.address ?? undefined,
        lat: p.lat,
        lon: p.lon,
      })),
      seatMap: {
        decks: [...decks.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([deck, rowsMap]) => ({
            deck,
            rows: [...rowsMap.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([row, rowSeats]) => ({ row, seats: rowSeats })),
          })),
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
