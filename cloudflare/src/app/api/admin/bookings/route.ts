import { getDb } from "@/lib/db/client";
import { bookings, routes, schedules, tripSessions } from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { bookingOut } from "@/lib/services/booking-out";

/**
 * `GET /api/admin/bookings?status=&brandId=&routeId=&dateFrom=&dateTo=&search=&limit=&offset=&sort=`
 * — admin ticket list across every user (Rust `AdminBookingListResponse`).
 * Typed builder filters (undefined parts skipped by `and()`); the
 * departure sorts order by a correlated trip-time expression.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:read");
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status");
    const status = statusRaw === "awaiting" ? "pending" : statusRaw;
    const search = url.searchParams.get("search")?.trim();
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");
    const brandId = url.searchParams.get("brandId");
    const routeId = url.searchParams.get("routeId");
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      100,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const sort = url.searchParams.get("sort") ?? "created_desc";

    const db = await getDb();
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

    // Departure-time sort key: the trip's departure_date + departure_time.
    const departureTime = sql<string>`(SELECT ts.departure_date || ' ' || s.departure_time
      FROM trip_session ts JOIN schedule s ON s.id = ts.schedule_id
      WHERE ts.id = ${bookings.tripSessionId})`;
    const orderBy =
      sort === "created_asc"
        ? asc(bookings.createdAt)
        : sort === "departure_desc"
          ? desc(departureTime)
          : sort === "departure_asc"
            ? asc(departureTime)
            : desc(bookings.createdAt);

    const rows = await db
      .select()
      .from(bookings)
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);
    const totalRow = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(where);
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
