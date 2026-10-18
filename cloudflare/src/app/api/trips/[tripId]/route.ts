import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
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
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  try {
    const { tripId } = await ctx.params;
    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT ts.id, ts.schedule_id, ts.departure_date, ts.status,
             ts.total_seats, ts.available_seats, ts.driver_name,
             r.id AS route_id, r.name AS route_name,
             r.start_location_id, r.end_location_id, r.brand_id,
             b.slug AS brand_slug, b.name AS brand_name,
             b.logo_url AS brand_logo_url, b.rating AS brand_rating,
             b.child_max_age AS brand_child_max_age,
             b.child_discount_amount AS brand_child_discount_amount,
             s.departure_time, s.amenities, s.base_price_adult, s.base_price_child,
             s.vehicle_type_id, s.bus_layout_id,
             vt.code AS vt_code, vt.label AS vt_label,
             bl.name AS layout_name, bl.vehicle_type AS layout_vehicle_type,
             bl.total_seats AS layout_total_seats
      FROM trip_session ts
      JOIN schedule s ON s.id = ts.schedule_id
      JOIN route r ON r.id = s.route_id
      LEFT JOIN brand b ON b.id = r.brand_id
      LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
      LEFT JOIN bus_layout bl ON bl.id = s.bus_layout_id
      WHERE ts.id = ${tripId}
      LIMIT 1
    `);
    const t = rows[0] as
      | (Record<string, unknown> & {
          id: string;
          schedule_id: string;
          departure_date: string;
          status: string;
          total_seats: number;
          available_seats: number;
          driver_name: string | null;
          route_id: string;
          route_name: string;
          start_location_id: string;
          end_location_id: string;
          brand_id: string | null;
          brand_slug: string | null;
          brand_name: string | null;
          brand_logo_url: string | null;
          brand_rating: number | null;
          brand_child_max_age: number | null;
          brand_child_discount_amount: number | null;
          departure_time: string;
          amenities: string | null;
          base_price_adult: number;
          base_price_child: number | null;
          vehicle_type_id: string | null;
          bus_layout_id: string | null;
          vt_code: string | null;
          vt_label: string | null;
          layout_name: string | null;
          layout_vehicle_type: string | null;
          layout_total_seats: number | null;
        })
      | undefined;
    if (!t) return err(404, "not-found", "Trip not found");

    // ── Seat rows + live inventory ──────────────────────────────
    const seatRows = t.bus_layout_id
      ? await rawAll<{
          id: string;
          seat_label: string;
          seat_class: string | null;
          row_num: number | null;
          col_num: number | null;
          floor: number;
          status: string;
          final_price: number | null;
        }>(sql`
          SELECT se.id, se.seat_label, se.seat_class, se.row_num, se.col_num, se.floor,
                 COALESCE(si.status, 'available') AS status,
                 si.final_price
          FROM seat se
          LEFT JOIN seat_inventory si ON si.seat_id = se.id AND si.trip_session_id = ${tripId}
          WHERE se.bus_layout_id = ${t.bus_layout_id}
          ORDER BY se.floor, se.row_num, se.col_num
        `)
      : [];

    // ── Fare table (per seat class) ─────────────────────────────
    const fareRows = await rawAll<{ seat_class: string; price_adult: number; price_child: number | null }>(sql`
      SELECT seat_class, price_adult, price_child FROM schedule_fare
      WHERE schedule_id = ${t.schedule_id}
    `);
    const fareByClass = new Map(
      fareRows.map((f) => [classOf(f.seat_class), { adult: f.price_adult, child: f.price_child }]),
    );
    const stdFare = { adult: t.base_price_adult, child: t.base_price_child };
    const fareOf = (seatClass: string | null): { adult: number; child: number | null } =>
      fareByClass.get(classOf(seatClass)) ?? stdFare;

    const policy = childPolicyOf({
      child_max_age: t.brand_child_max_age,
      child_discount_amount: t.brand_child_discount_amount,
    });

    // ── Per-class fare summary (Rust `trip_fares`) ───────────────
    interface FareSummary {
      seatClass: string;
      fareAdult: number;
      fareChild: number | null;
      priceAdult: number;
      cheapestAvailable: number | null;
      cheapest: number;
      seats: number;
      available: number;
    }
    const classFares = new Map<string, FareSummary>();
    const decks = new Map<number, Map<number, Array<Record<string, unknown>>>>();
    for (const s of seatRows) {
      const seatClass = classOf(s.seat_class);
      const fare = fareOf(s.seat_class);
      const price = s.final_price ?? fare.adult;
      const available = s.status === "available";
      const cur =
        classFares.get(seatClass) ??
        ({
          seatClass,
          fareAdult: fare.adult,
          fareChild: fare.child,
          priceAdult: price,
          cheapestAvailable: null,
          cheapest: Number.MAX_SAFE_INTEGER,
          seats: 0,
          available: 0,
        } as FareSummary);
      cur.seats++;
      cur.cheapest = Math.min(cur.cheapest, price);
      if (available) {
        cur.available++;
        cur.cheapestAvailable = Math.min(cur.cheapestAvailable ?? price, price);
      }
      classFares.set(seatClass, cur);

      const deck = s.floor;
      const row = s.row_num ?? 0;
      if (!decks.has(deck)) decks.set(deck, new Map());
      const rowsMap = decks.get(deck)!;
      if (!rowsMap.has(row)) rowsMap.set(row, []);
      rowsMap.get(row)!.push({
        id: s.id,
        code: s.seat_label,
        seatLabel: s.seat_label,
        row,
        col: s.col_num ?? 0,
        deck,
        seatClass: s.seat_class ?? undefined,
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
    const pickupPoints = await rawAll<{
      id: string;
      name: string | null;
      stop_order: number | null;
      lat: number | null;
      lon: number | null;
      kind: string | null;
      address: string | null;
    }>(sql`
      SELECT id, name, stop_order, lat, lon, kind, address
      FROM pickup_point WHERE route_id = ${t.route_id} ORDER BY stop_order
    `);
    const schedulePoints = await rawAll<{
      id: string;
      stop_order: number;
      kind: string;
      arrival_time: string | null;
      name: string;
      address: string | null;
      lat: number;
      lon: number;
    }>(sql`
      SELECT sp.id, sp.stop_order, sp.kind, sp.arrival_time,
             a.name AS name, a.address AS address, a.lat, a.lon
      FROM schedule_point sp
      JOIN address a ON a.id = sp.address_id
      WHERE sp.schedule_id = ${t.schedule_id}
      ORDER BY sp.stop_order
    `);

    // ── Times + bookable ─────────────────────────────────────────
    const departureAt = computeIsoTimestamps(t.departure_date, t.departure_time) ?? undefined;
    const lastArrival = [...schedulePoints].reverse().find((p) => p.arrival_time && p.arrival_time !== "");
    const arrivalAt = lastArrival?.arrival_time
      ? (computeArrivalIso(t.departure_date, t.departure_time, lastArrival.arrival_time) ?? undefined)
      : undefined;
    const vnNow = new Date(Date.now() + 7 * 3_600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const nowDate = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;
    const nowTime = `${pad(vnNow.getUTCHours())}:${pad(vnNow.getUTCMinutes())}`;
    const bookable =
      t.status === "scheduled" &&
      (t.departure_date > nowDate || (t.departure_date === nowDate && t.departure_time >= nowTime));

    const catalog = await vehicleTypeCatalog();
    const [vehicleType, vehicleTypeLabel] = resolveVehicleType(
      { vt_code: t.vt_code, vt_label: t.vt_label, layout_vehicle_type: t.layout_vehicle_type },
      catalog,
    );
    const from = findCity(t.start_location_id);
    const to = findCity(t.end_location_id);

    return Response.json({
      trip: {
        id: t.id,
        bookable,
        departureDate: t.departure_date,
        departureAt,
        departureTime: t.departure_time,
        arrivalAt,
        status: t.status,
        driverName: t.driver_name ?? undefined,
        totalSeats: t.total_seats,
        availableSeats: t.available_seats,
      },
      route: { id: t.route_id, name: t.route_name },
      brand: t.brand_id
        ? {
            id: t.brand_id,
            name: t.brand_name,
            slug: t.brand_slug,
            logoUrl: t.brand_logo_url,
            rating: t.brand_rating,
          }
        : {},
      from: { name: from?.name, lat: from?.lat ?? 0, lon: from?.lon ?? 0 },
      to: { name: to?.name, lat: to?.lat ?? 0, lon: to?.lon ?? 0 },
      busLayout: {
        id: t.bus_layout_id ?? undefined,
        name: t.layout_name ?? undefined,
        capacity: t.layout_total_seats ?? undefined,
        vehicleType,
        vehicleTypeLabel,
      },
      pricing: {
        basePriceAdult: t.base_price_adult,
        basePriceChild: standardChildPrice(
          { base_price_adult: t.base_price_adult, base_price_child: t.base_price_child },
          policy,
        ),
        fares,
        childFare: policy ?? undefined,
      },
      amenities: parseAmenities(t.amenities).map((key) => ({ key, label: amenityLabel(key) || key })),
      pickupPoints: pickupPoints.map((p) => ({
        id: p.id,
        name: p.name ?? undefined,
        stopOrder: p.stop_order ?? undefined,
        lat: p.lat ?? undefined,
        lon: p.lon ?? undefined,
        kind: p.kind ?? undefined,
        address: p.address ?? undefined,
      })),
      schedulePoints: schedulePoints.map((p) => ({
        id: p.id,
        stopOrder: p.stop_order,
        kind: p.kind,
        arrivalTime: p.arrival_time || undefined,
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
              .map(([row, seats]) => ({ row, seats })),
          })),
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
