import { getDb } from "@/lib/db/client";
import { and, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { bookings, routes, schedules, tripSessions } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/bookings/stats?status=&brandId=&routeId=&dateFrom=&dateTo=&search=`
 * — totals + per-day buckets for the tickets dashboard (Rust
 * `AdminBookingStatsResponse`). Same filters as the list endpoint, built
 * once as a typed drizzle condition (undefined parts are skipped by
 * `and()`).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:stats:read");
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status");
    const status = statusRaw === "awaiting" ? "pending" : statusRaw;
    const search = url.searchParams.get("search")?.trim();
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const brandId = url.searchParams.get("brandId");
    const routeId = url.searchParams.get("routeId");

    // Shared WHERE — trips of a brand/route scope via typed subqueries.
    const tripsOfBrand = () =>
      db
        .select({ id: tripSessions.id })
        .from(tripSessions)
        .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
        .innerJoin(routes, eq(routes.id, schedules.routeId))
        .where(eq(routes.brandId, brandId as string));
    const tripsOfRoute = () =>
      db
        .select({ id: tripSessions.id })
        .from(tripSessions)
        .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
        .where(eq(schedules.routeId, routeId as string));

    const db = await getDb();
    const where = and(
      status != null ? eq(bookings.status, status) : undefined,
      search != null && search.length > 0
        ? or(
            like(bookings.code, `%${search}%`),
            like(bookings.contactName, `%${search}%`),
            like(bookings.contactPhone, `%${search}%`),
          )
        : undefined,
      dateFrom != null ? gte(bookings.createdAt, dateFrom) : undefined,
      dateTo != null ? lte(bookings.createdAt, `${dateTo}T23:59:59`) : undefined,
      brandId != null ? inArray(bookings.tripSessionId, tripsOfBrand()) : undefined,
      routeId != null ? inArray(bookings.tripSessionId, tripsOfRoute()) : undefined,
    );

    // Status buckets via COUNT/SUM FILTER — one typed aggregate pass each.
    const bucketCols = {
      total: sql<number>`COUNT(*)`,
      pending: sql<number>`COUNT(*) FILTER (WHERE ${bookings.status} = 'pending')`,
      confirmed: sql<number>`COUNT(*) FILTER (WHERE ${bookings.status} = 'confirmed')`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${bookings.status} = 'completed')`,
      cancelled: sql<number>`COUNT(*) FILTER (WHERE ${bookings.status} = 'cancelled')`,
      revenue: sql<number>`COALESCE(SUM(${bookings.total}) FILTER (WHERE ${bookings.status} IN ('confirmed', 'completed')), 0)`,
    };
    const totals = await db.select(bucketCols).from(bookings).where(where);
    const byDay = await db
      .select({
        date: sql<string>`date(${bookings.createdAt})`,
        ...bucketCols,
      })
      .from(bookings)
      .where(where)
      .groupBy(sql`date(${bookings.createdAt})`)
      .orderBy(sql`date(${bookings.createdAt})`);

    const t = totals[0];
    return Response.json({
      totals: {
        total: Number(t?.total ?? 0),
        pending: Number(t?.pending ?? 0),
        confirmed: Number(t?.confirmed ?? 0),
        completed: Number(t?.completed ?? 0),
        cancelled: Number(t?.cancelled ?? 0),
        revenue: Number(t?.revenue ?? 0),
      },
      byDay: byDay.map((d) => ({
        date: d.date,
        count: Number(d.total),
        pending: Number(d.pending),
        confirmed: Number(d.confirmed),
        completed: Number(d.completed),
        cancelled: Number(d.cancelled),
        revenue: Number(d.revenue),
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
