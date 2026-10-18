import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";

export async function GET() {
  try {
    const rows = await rawAll<{ brands: number; routes: number; trips: number; bookings: number; confirmed: number; reviews: number; users: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM brand WHERE status = 'active') AS brands,
        (SELECT COUNT(*) FROM route WHERE status = 'active') AS routes,
        (SELECT COUNT(*) FROM trip_session WHERE departure_date >= date('now')) AS trips,
        (SELECT COUNT(*) FROM booking) AS bookings,
        (SELECT COUNT(*) FROM booking WHERE status = 'confirmed') AS confirmed,
        (SELECT COUNT(*) FROM review WHERE status = 'published') AS reviews,
        (SELECT COUNT(*) FROM "user") AS users
    `);
    const agg = rows[0] ?? { brands: 0, routes: 0, trips: 0, bookings: 0, confirmed: 0, reviews: 0, users: 0 };
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(agg)) stats[k] = Number(v);
    return Response.json(stats);
  } catch (e) {
    return handleRouteError(e);
  }
}
