import { getDb } from "@/lib/db/client";
import { eq, sql } from "drizzle-orm";
import { bookings, payments, tripSessions } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { chatStats } from "@/lib/services/chat";

/** GET /api/admin/stats — ops dashboard aggregates. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:stats:read");
    const db = await getDb();

    // One conditional-aggregate round trip instead of three COUNT queries.
    const bookingRows = await db
      .select({
        pending: sql<number>`SUM(CASE WHEN ${bookings.status} = 'pending' THEN 1 ELSE 0 END)`,
        confirmed: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' THEN 1 ELSE 0 END)`,
        cancelled: sql<number>`SUM(CASE WHEN ${bookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      })
      .from(bookings);
    const b = bookingRows[0] ?? { pending: 0, confirmed: 0, cancelled: 0 };
    const bookingsByStatus: Record<string, number> = {
      pending: Number(b.pending),
      confirmed: Number(b.confirmed),
      cancelled: Number(b.cancelled),
    };

    const revenueRows = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.status, "completed"));
    const todayRows = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(sql`date(${bookings.createdAt}) = date('now')`);
    const tripsToday = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(tripSessions)
      .where(sql`${tripSessions.departureDate} = date('now')`);

    const chat = await chatStats(db);
    return Response.json({
      bookings: bookingsByStatus,
      bookingsToday: Number(todayRows[0]?.n ?? 0),
      revenueTotal: Number(revenueRows[0]?.total ?? 0),
      tripsToday: Number(tripsToday[0]?.n ?? 0),
      chat,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
