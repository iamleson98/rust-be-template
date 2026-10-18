import { getDb, rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, err } from "@/lib/api";
import { serializeTrip } from "@/lib/services/trip-search";
import { ensureSaleWindow } from "@/lib/services/trip-detail";

export async function GET(_req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  try {
    const { tripId } = await ctx.params;
    const db = await getDb();
    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT ts.id, ts.schedule_id, ts.departure_date, ts.status,
             ts.total_seats, ts.available_seats,
             r.id AS route_id, r.name AS route_name,
             r.start_location_id, r.end_location_id,
             b.id AS brand_id, b.slug AS brand_slug, b.name AS brand_name,
             b.logo_url AS brand_logo_url, b.rating AS brand_rating,
             vt.code AS vehicle_type_code, vt.label AS vehicle_type_label,
             s.amenities, s.base_price_adult, s.base_price_child,
             s.departure_time, s.bus_layout_id,
             (SELECT COALESCE(
               (SELECT MIN(final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available'),
               (SELECT MIN(price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id),
               s.base_price_adult)) AS min_price
      FROM trip_session ts
      JOIN schedule s ON s.id = ts.schedule_id
      JOIN route r ON r.id = s.route_id
      LEFT JOIN brand b ON b.id = r.brand_id
      LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
      WHERE ts.id = ${tripId}
      LIMIT 1
    `);
    const t = rows[0] as Record<string, unknown> | undefined;
    if (!t) return err(404, "not-found", "Trip not found");

    // Seat map + fares + pickup points.
    const seatRows = (t.bus_layout_id as string | null)
      ? await rawAll<Record<string, unknown>>(sql`
          SELECT se.id, se.seat_label, se.seat_class, se.row_num, se.col_num,
                 se.is_window, se.floor,
                 COALESCE(si.status, 'available') AS status,
                 COALESCE(si.final_price,
                   (SELECT price_adult FROM schedule_fare sf
                    WHERE sf.schedule_id = ${t["schedule_id"]} AND sf.seat_class = se.seat_class),
                   ${t["base_price_adult"]}) AS price
          FROM seat se
          LEFT JOIN seat_inventory si ON si.seat_id = se.id AND si.trip_session_id = ${tripId}
          WHERE se.bus_layout_id = ${t["bus_layout_id"]}
          ORDER BY se.floor, se.row_num, se.col_num
        `)
      : [];
    const fares = await rawAll<Record<string, unknown>>(sql`
      SELECT seat_class, price_adult, price_child FROM schedule_fare
      WHERE schedule_id = ${t["schedule_id"]}
    `);
    const points = await rawAll<Record<string, unknown>>(sql`
      SELECT id, name, address, lat, lon, stop_order, kind FROM pickup_point
      WHERE route_id = ${t["route_id"]} ORDER BY stop_order
    `);

    return Response.json({
      ...serializeTrip(t as unknown as Parameters<typeof serializeTrip>[0]),
      seats: seatRows.map((s: Record<string, unknown>) => ({
        id: s.id as string,
        label: s.seat_label as string,
        seatClass: (s.seat_class as string | null) ?? "standard",
        row: s.row_num as number | null,
        col: s.col_num as number | null,
        isWindow: Boolean(s.is_window),
        floor: (s.floor as number) ?? 1,
        status: s.status as string,
        price: Number(s.price ?? t.base_price_adult),
      })),
      fares: fares.map((f: Record<string, unknown>) => ({
        seatClass: f.seat_class as string,
        adult: Number(f.price_adult),
        child: f.price_child != null ? Number(f.price_child) : null,
      })),
      boardingPoints: points
        .filter((p: Record<string, unknown>) => p.kind !== "drop")
        .map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: p.name as string,
          address: p.address as string | null,
        })),
      droppingPoints: points
        .filter((p: Record<string, unknown>) => p.kind === "drop" || p.kind == null)
        .map((p: Record<string, unknown>) => ({
          id: p.id as string,
          name: p.name as string,
          address: p.address as string | null,
        })),
      sellWindow: ensureSaleWindow(t.departure_date as string),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
