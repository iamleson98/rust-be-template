import { getDb, rawAll } from "@/lib/db/client";
import { bookings } from "@/lib/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { bookingOut } from "@/lib/services/booking-out";

/**
 * `GET /api/admin/bookings?status=&brandId=&routeId=&dateFrom=&dateTo=&search=&limit=&offset=&sort=`
 * — admin ticket list across every user (Rust `AdminBookingListResponse`).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:read");
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status") ?? undefined;
    const status = statusRaw === "awaiting" ? "pending" : statusRaw;
    const search = url.searchParams.get("search")?.trim() || undefined;
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;
    const brandId = url.searchParams.get("brandId") ?? undefined;
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const sort = url.searchParams.get("sort") ?? "created_desc";

    const db = await getDb();
    const conds: SQL[] = [];
    if (status) conds.push(eq(bookings.status, status));
    if (search) {
      conds.push(
        sql`(${bookings.code} LIKE ${"%" + search + "%"} OR ${bookings.contactName} LIKE ${"%" + search + "%"} OR ${bookings.contactPhone} LIKE ${"%" + search + "%"})`,
      );
    }
    if (dateFrom) conds.push(sql`${bookings.createdAt} >= ${dateFrom}`);
    if (dateTo) conds.push(sql`${bookings.createdAt} <= ${dateTo + "T23:59:59"}`);
    if (brandId) {
      conds.push(
        sql`${bookings.tripSessionId} IN (SELECT ts2.id FROM trip_session ts2 JOIN schedule s2 ON s2.id = ts2.schedule_id JOIN route r2 ON r2.id = s2.route_id WHERE r2.brand_id = ${brandId})`,
      );
    }
    if (routeId) {
      conds.push(
        sql`${bookings.tripSessionId} IN (SELECT ts3.id FROM trip_session ts3 JOIN schedule s3 ON s3.id = ts3.schedule_id WHERE s3.route_id = ${routeId})`,
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const orderBy =
      sort === "created_asc"
        ? sql`${bookings.createdAt} ASC`
        : sort === "departure_desc"
          ? sql`(SELECT ts.departure_date || ' ' || s.departure_time FROM trip_session ts JOIN schedule s ON s.id = ts.schedule_id WHERE ts.id = ${bookings.tripSessionId}) DESC`
          : sort === "departure_asc"
            ? sql`(SELECT ts.departure_date || ' ' || s.departure_time FROM trip_session ts JOIN schedule s ON s.id = ts.schedule_id WHERE ts.id = ${bookings.tripSessionId}) ASC`
            : sql`${bookings.createdAt} DESC`;

    const rows = await db
      .select()
      .from(bookings)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);
    const totalRow = await db.select({ n: sql<number>`count(*)` }).from(bookings).where(where);
    const items = await Promise.all(rows.map((r) => bookingOut(r)));
    return Response.json({
      items,
      total: Number(totalRow[0]?.n ?? 0),
      limit,
      offset,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
