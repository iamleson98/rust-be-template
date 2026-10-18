import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/bookings/stats?status=&brandId=&routeId=&dateFrom=&dateTo=&search=`
 * — totals + per-day buckets for the tickets dashboard (Rust
 * `AdminBookingStatsResponse`). Same filters as the list endpoint.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:stats:read");
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status") ?? undefined;
    const status = statusRaw === "awaiting" ? "pending" : statusRaw;
    const search = url.searchParams.get("search")?.trim() || undefined;
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const routeId = url.searchParams.get("routeId") ?? undefined;

    const filters = sql`
      ${status ? sql`AND b.status = ${status}` : sql``}
      ${search ? sql`AND (b.code LIKE ${"%" + search + "%"} OR b.contact_name LIKE ${"%" + search + "%"} OR b.contact_phone LIKE ${"%" + search + "%"})` : sql``}
      ${dateFrom ? sql`AND b.created_at >= ${dateFrom}` : sql``}
      ${dateTo ? sql`AND b.created_at <= ${dateTo + "T23:59:59"}` : sql``}
      ${brandId ? sql`AND b.trip_session_id IN (SELECT ts2.id FROM trip_session ts2 JOIN schedule s2 ON s2.id = ts2.schedule_id JOIN route r2 ON r2.id = s2.route_id WHERE r2.brand_id = ${brandId})` : sql``}
      ${routeId ? sql`AND b.trip_session_id IN (SELECT ts3.id FROM trip_session ts3 JOIN schedule s3 ON s3.id = ts3.schedule_id WHERE s3.route_id = ${routeId})` : sql``}
    `;

    // Totals: revenue counts confirmed + completed tickets only.
    const totals = await rawAll<{
      total: number;
      pending: number;
      confirmed: number;
      completed: number;
      cancelled: number;
      revenue: number;
    }>(sql`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
             SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
             SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total ELSE 0 END) AS revenue
      FROM booking b WHERE 1=1 ${filters}
    `);

    // Per-day buckets over the (possibly filtered) set.
    const byDay = await rawAll<{
      date: string;
      count: number;
      pending: number;
      confirmed: number;
      completed: number;
      cancelled: number;
      revenue: number;
    }>(sql`
      SELECT date(b.created_at) AS date,
             COUNT(*) AS count,
             SUM(CASE WHEN b.status = 'pending' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
             SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
             SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total ELSE 0 END) AS revenue
      FROM booking b WHERE 1=1 ${filters}
      GROUP BY date(b.created_at)
      ORDER BY date(b.created_at)
    `);

    const t = totals[0] ?? { total: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0, revenue: 0 };
    return Response.json({
      totals: {
        total: Number(t.total),
        pending: Number(t.pending),
        confirmed: Number(t.confirmed),
        completed: Number(t.completed),
        cancelled: Number(t.cancelled),
        revenue: Number(t.revenue),
      },
      byDay: byDay.map((d) => ({
        date: d.date,
        count: Number(d.count),
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
