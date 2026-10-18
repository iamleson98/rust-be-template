import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/bookings/export` — CSV export of the filtered ticket
 * list (Rust `AdminBookingExportResponse`: columns, csv, count, filename).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:export");
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status") ?? undefined;
    const status = statusRaw === "awaiting" ? "pending" : statusRaw;
    const search = url.searchParams.get("search")?.trim() || undefined;
    const dateFrom = url.searchParams.get("dateFrom") ?? undefined;
    const dateTo = url.searchParams.get("dateTo") ?? undefined;

    const rows = await rawAll<Record<string, unknown>>(sql`
      SELECT b.code, b.status, b.total, b.currency, b.contact_name, b.contact_phone,
             b.contact_email, b.created_at,
             (SELECT COUNT(*) FROM booking_seat bs WHERE bs.booking_id = b.id) AS seats,
             (SELECT r.name FROM trip_session ts JOIN schedule s ON s.id = ts.schedule_id
               JOIN route r ON r.id = s.route_id WHERE ts.id = b.trip_session_id) AS route_name,
             (SELECT ts.departure_date || ' ' || s.departure_time FROM trip_session ts
               JOIN schedule s ON s.id = ts.schedule_id WHERE ts.id = b.trip_session_id) AS departure
      FROM booking b
      WHERE 1=1
        ${status ? sql`AND b.status = ${status}` : sql``}
        ${search ? sql`AND (b.code LIKE ${"%" + search + "%"} OR b.contact_name LIKE ${"%" + search + "%"} OR b.contact_phone LIKE ${"%" + search + "%"})` : sql``}
        ${dateFrom ? sql`AND b.created_at >= ${dateFrom}` : sql``}
        ${dateTo ? sql`AND b.created_at <= ${dateTo + "T23:59:59"}` : sql``}
      ORDER BY b.created_at DESC
      LIMIT 10000
    `);

    const columns = [
      "code",
      "status",
      "seats",
      "route",
      "departure",
      "total",
      "currency",
      "contact_name",
      "contact_phone",
      "contact_email",
      "created_at",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      columns.join(","),
      ...rows.map((r) =>
        columns
          .map((c) => esc(c === "route" ? r.route_name : c === "seats" ? r.seats : c === "departure" ? r.departure : r[c]))
          .join(","),
      ),
    ].join("\n");

    const today = new Date().toISOString().slice(0, 10);
    return Response.json({
      columns,
      csv,
      count: rows.length,
      filename: `bookings-${today}.csv`,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
