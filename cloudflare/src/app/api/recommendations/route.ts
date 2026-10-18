import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { serializeTrip } from "@/lib/services/trip-search";

/** Curated recommendations: near-term trips with the best availability. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "6", 10) || 6, 20);
    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT ts.id, ts.schedule_id, ts.departure_date, ts.status,
             ts.total_seats, ts.available_seats,
             r.id AS route_id, r.name AS route_name,
             r.start_location_id, r.end_location_id,
             b.id AS brand_id, b.slug AS brand_slug, b.name AS brand_name,
             b.logo_url AS brand_logo_url, b.rating AS brand_rating,
             vt.code AS vehicle_type_code, vt.label AS vehicle_type_label,
             s.amenities, s.base_price_adult, s.base_price_child,
             s.departure_time,
             (SELECT COALESCE(
               (SELECT MIN(final_price) FROM seat_inventory si WHERE si.trip_session_id = ts.id AND si.status = 'available'),
               (SELECT MIN(price_adult) FROM schedule_fare sf WHERE sf.schedule_id = s.id),
               s.base_price_adult)) AS min_price
      FROM trip_session ts
      JOIN schedule s ON s.id = ts.schedule_id
      JOIN route r ON r.id = s.route_id
      LEFT JOIN brand b ON b.id = r.brand_id
      LEFT JOIN vehicle_type vt ON vt.id = s.vehicle_type_id
      WHERE ts.departure_date >= date('now') AND ts.status = 'scheduled'
      ORDER BY ts.available_seats DESC, ts.departure_date ASC, s.departure_time ASC
      LIMIT ${limit}
    `);
    return Response.json({ items: rows.map((r) => serializeTrip(r as unknown as Parameters<typeof serializeTrip>[0])) });
  } catch (e) {
    return handleRouteError(e);
  }
}
