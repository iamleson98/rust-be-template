import { getDb, rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { chatStats } from "@/lib/services/chat";

/** GET /api/admin/stats — ops dashboard aggregates. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:stats:read");
    const db = await getDb();
    const bookingRows = await rawAll<{ pending: number; confirmed: number; cancelled: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM booking WHERE status = 'pending') AS pending,
        (SELECT COUNT(*) FROM booking WHERE status = 'confirmed') AS confirmed,
        (SELECT COUNT(*) FROM booking WHERE status = 'cancelled') AS cancelled
    `);
    const b = bookingRows[0] ?? { pending: 0, confirmed: 0, cancelled: 0 };
    const bookings: Record<string, number> = {
      pending: Number(b.pending),
      confirmed: Number(b.confirmed),
      cancelled: Number(b.cancelled),
    };
    const revenueRows = await rawAll<{ total: number }>(sql`
      SELECT COALESCE(SUM(amount), 0) AS total FROM payment WHERE status = 'completed'
    `);
    const todayRows = await rawAll<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM booking WHERE date(created_at) = date('now')
    `);
    const tripsToday = await rawAll<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM trip_session WHERE departure_date = date('now')
    `);
    const chat = await chatStats(db);
    return Response.json({
      bookings,
      bookingsToday: Number(todayRows[0]?.n ?? 0),
      revenueTotal: Number(revenueRows[0]?.total ?? 0),
      tripsToday: Number(tripsToday[0]?.n ?? 0),
      chat,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
