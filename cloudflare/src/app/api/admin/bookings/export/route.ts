import { getDb } from "@/lib/db/client";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { bookingSeats, bookings, routes, schedules, tripSessions } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/** One CSV row: booking fields + computed seats/route/departure. */
interface ExportRow {
  code: string;
  status: string;
  seats: number;
  routeName: string | null;
  departure: string | null;
  total: number;
  currency: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
}

const csvColumns: Array<{ col: string; get: (r: ExportRow) => string | number | null }> = [
  { col: "code", get: (r) => r.code },
  { col: "status", get: (r) => r.status },
  { col: "seats", get: (r) => r.seats },
  { col: "route", get: (r) => r.routeName },
  { col: "departure", get: (r) => r.departure },
  { col: "total", get: (r) => r.total },
  { col: "currency", get: (r) => r.currency },
  { col: "contact_name", get: (r) => r.contactName },
  { col: "contact_phone", get: (r) => r.contactPhone },
  { col: "contact_email", get: (r) => r.contactEmail },
  { col: "created_at", get: (r) => r.createdAt },
];

/**
 * `GET /api/admin/bookings/export` — CSV export of the filtered ticket
 * list (Rust `AdminBookingExportResponse`: columns, csv, count, filename).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:export");
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status");
    const status = statusRaw === "awaiting" ? "pending" : statusRaw;
    const search = url.searchParams.get("search")?.trim();
    const dateFrom = url.searchParams.get("dateFrom");
    const dateTo = url.searchParams.get("dateTo");

    const db = await getDb();
    const rows = await db
      .select({
        code: bookings.code,
        status: bookings.status,
        seats: sql<number>`(SELECT COUNT(*) FROM ${bookingSeats} WHERE ${bookingSeats.bookingId} = ${bookings.id})`,
        routeName: sql<string | null>`(SELECT r.name FROM ${tripSessions} ts
          JOIN ${schedules} s ON s.id = ts.schedule_id
          JOIN ${routes} r ON r.id = s.route_id WHERE ts.id = ${bookings.tripSessionId})`,
        departure: sql<
          string | null
        >`(SELECT ts.departure_date || ' ' || s.departure_time FROM ${tripSessions} ts
          JOIN ${schedules} s ON s.id = ts.schedule_id WHERE ts.id = ${bookings.tripSessionId})`,
        total: bookings.total,
        currency: bookings.currency,
        contactName: bookings.contactName,
        contactPhone: bookings.contactPhone,
        contactEmail: bookings.contactEmail,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(
        and(
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
        ),
      )
      .orderBy(desc(bookings.createdAt))
      .limit(10_000);

    const esc = (v: string | number | null): string => {
      const s = v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      csvColumns.map((c) => c.col).join(","),
      ...rows.map((r) => csvColumns.map((c) => esc(c.get(r))).join(",")),
    ].join("\n");

    const today = new Date().toISOString().slice(0, 10);
    return Response.json({
      columns: csvColumns.map((c) => c.col),
      csv,
      count: rows.length,
      filename: `bookings-${today}.csv`,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
