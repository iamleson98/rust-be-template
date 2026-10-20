/**
 * Booking management for staff — port of `admin_service/bookings.rs`: list,
 * detail, status changes, stats and CSV export.
 */
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import {
  badRequest,
  cancelBookingRow,
  completeBooking,
  conflict,
  confirmPending,
  departureOf,
  findBooking,
  gone,
  notFound,
} from "./booking";
import {
  bookingFacts,
  bookingView,
  bookingViews,
  countBookings,
  listBookings,
  type BookingFilter,
  type BookingOut,
} from "./booking-out";
import { localDate, localDayStart } from "./trip-time";

export interface AdminBookingsQuery {
  /** A booking status, `awaiting` (pay on board, waiting for the phone call) or `all`. */
  status?: string | null;
  brandId?: string | null;
  routeId?: string | null;
  /** First day booked on (`YYYY-MM-DD`, Vietnam). */
  dateFrom?: string | null;
  /** Last day booked on (`YYYY-MM-DD`, Vietnam), inclusive. */
  dateTo?: string | null;
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
  /** `created_desc` (default), `created_asc`, `total_desc` or `total_asc`. */
  sort?: string | null;
}

/** Read the query string the admin booking endpoints share. */
export function adminQueryOf(url: URL): AdminBookingsQuery {
  const p = url.searchParams;
  const num = (key: string): number | null => {
    const n = Number(p.get(key));
    return p.has(key) && Number.isInteger(n) && n >= 0 ? n : null;
  };
  return {
    status: p.get("status"),
    brandId: p.get("brandId"),
    routeId: p.get("routeId"),
    dateFrom: p.get("dateFrom"),
    dateTo: p.get("dateTo"),
    search: p.get("search"),
    limit: num("limit"),
    offset: num("offset"),
    sort: p.get("sort"),
  };
}

/**
 * What an admin listing selects: tickets only (no unfinished checkouts) by
 * `status` (or `awaiting`: pay-on-board tickets waiting for the phone
 * call), brand, route, search and the Vietnamese calendar days
 * `dateFrom..=dateTo` they were booked on, in the `sort` order.
 */
export function adminFilter(q: AdminBookingsQuery): BookingFilter {
  const status = q.status?.trim();
  const named = status && status !== "all" ? status : undefined;
  const awaiting = named === "awaiting";
  // The start of `date`, `daysLater` days on, as stored timestamps read.
  const dayStart = (date: string | null | undefined, daysLater: number): string | undefined => {
    const d = date?.trim();
    if (!d) return undefined;
    const start = localDayStart(d);
    if (!start) throw badRequest(`${d} is not a YYYY-MM-DD date`);
    return new Date(start.getTime() + daysLater * 86_400_000).toISOString();
  };
  return {
    status: awaiting ? "pending" : named,
    paymentMethod: awaiting ? "cod" : undefined,
    placed: true,
    search: q.search ?? undefined,
    brandId: q.brandId || undefined,
    routeId: q.routeId || undefined,
    createdFrom: dayStart(q.dateFrom, 0),
    createdBefore: dayStart(q.dateTo, 1),
    order:
      q.sort === "created_asc"
        ? "oldest"
        : q.sort === "total_desc"
          ? "total_desc"
          : q.sort === "total_asc"
            ? "total_asc"
            : "newest",
  };
}

/** A page of the tickets `q` selects. */
export async function adminListBookings(q: AdminBookingsQuery) {
  const limit = Math.min(q.limit ?? 50, 200);
  const offset = q.offset ?? 0;
  const filter = adminFilter(q);
  const total = await countBookings(filter);
  const rows = await listBookings(filter, limit, offset);
  return { items: await bookingViews(rows), total, limit, offset };
}

export async function adminGetBooking(id: string): Promise<{ item: BookingOut }> {
  const b = await findBooking(id);
  if (!b) throw notFound("booking not found");
  return { item: await bookingView(b) };
}

const changed = () => conflict("the booking was changed by another request");

/**
 * Staff move a ticket on: confirm it after phoning the customer (`pending`
 * → `confirmed`, the seats become booked), mark it `completed` after the
 * trip, or cancel it (the seats go back on sale). Completed and cancelled
 * tickets are final.
 */
export async function adminUpdateBookingStatus(
  actorId: string,
  id: string,
  body: { status: string; reason?: string | null },
): Promise<{ item: BookingOut }> {
  if (typeof body.status !== "string" || body.status.length < 1 || body.status.length > 30)
    throw badRequest("status has an invalid length");
  if (body.reason != null && body.reason.length > 1000)
    throw badRequest("reason has an invalid length");
  const b = await findBooking(id);
  if (!b) throw notFound("booking not found");

  const from = b.status;
  const to = body.status;
  if (from === "completed" || from === "cancelled")
    throw conflict(`ticket ${b.code} is ${from} and can no longer change`);
  if (from === "pending" && to === "confirmed") {
    const outcome = await confirmPending(b.id, b.paymentMethod ?? "cod");
    if (outcome === "not-pending") throw changed();
    if (outcome === "seats-lost") throw gone("the seats of this booking were already released");
  } else if (from === "confirmed" && to === "completed") {
    // Completing is final, so only once the trip has actually left.
    const departs = await departureOf(b);
    if (departs && departs.getTime() > Date.now())
      throw badRequest("the trip has not left yet; complete the ticket after departure");
    if (!(await completeBooking(b.id))) throw changed();
  } else if ((from === "pending" || from === "confirmed") && to === "cancelled") {
    if (!(await cancelBookingRow(b.id, ["pending", "confirmed"]))) throw changed();
  } else {
    throw badRequest(`a ${from} ticket cannot become ${to}`);
  }

  // Who did it and why, for the record (best-effort).
  try {
    const db = await getDb();
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      actorType: "staff",
      actorId,
      action: `booking_${to}`,
      targetType: "booking",
      targetId: b.id,
      metadata: body.reason ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[admin] audit log write failed", e);
  }
  return adminGetBooking(b.id);
}

interface Tally {
  count: number;
  revenue: number;
  confirmed: number;
  cancelled: number;
  completed: number;
  pending: number;
}

const emptyTally = (): Tally => ({
  count: 0,
  revenue: 0,
  confirmed: 0,
  cancelled: 0,
  completed: 0,
  pending: 0,
});

function addTo(t: Tally, status: string, total: number): void {
  t.count += 1;
  if (status === "confirmed") {
    t.confirmed += 1;
    t.revenue += total;
  } else if (status === "completed") {
    t.completed += 1;
    t.revenue += total;
  } else if (status === "cancelled") t.cancelled += 1;
  else t.pending += 1;
}

/**
 * Ticket counts and revenue for the tickets `q` selects, overall and per
 * Vietnamese calendar day. Revenue is what confirmed and completed tickets
 * bring in.
 */
export async function adminBookingStats(q: AdminBookingsQuery) {
  const facts = await bookingFacts(adminFilter(q));
  const totals = emptyTally();
  const byDay = new Map<string, Tally>();
  for (const f of facts) {
    addTo(totals, f.status, f.total);
    const day = localDate(f.createdAt);
    if (day) {
      const t = byDay.get(day) ?? emptyTally();
      addTo(t, f.status, f.total);
      byDay.set(day, t);
    }
  }
  return {
    totals: {
      total: totals.count,
      revenue: totals.revenue,
      confirmed: totals.confirmed,
      cancelled: totals.cancelled,
      completed: totals.completed,
      pending: totals.pending,
    },
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, d]) => ({
        date,
        count: d.count,
        revenue: d.revenue,
        confirmed: d.confirmed,
        cancelled: d.cancelled,
        completed: d.completed,
        pending: d.pending,
      })),
  };
}

const EXPORT_COLUMNS = [
  "code",
  "status",
  "contactName",
  "contactPhone",
  "total",
  "paymentMethod",
  "createdAt",
] as const;

/** Export bookings as CSV (UTF-8 BOM, every value quoted), a page of 1000 rows at a time. */
export async function adminBookingExport(q: AdminBookingsQuery) {
  const filter = adminFilter(q);
  let csv = "﻿" + EXPORT_COLUMNS.join(",") + "\n";
  let count = 0;
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await listBookings(filter, PAGE, offset);
    if (rows.length === 0) break;
    for (const b of rows) {
      const values: Record<(typeof EXPORT_COLUMNS)[number], string> = {
        code: b.code,
        status: b.status,
        contactName: b.contactName ?? "",
        contactPhone: b.contactPhone ?? "",
        total: String(b.total),
        paymentMethod: b.paymentMethod ?? "",
        createdAt: b.createdAt,
      };
      csv += EXPORT_COLUMNS.map((c) => `"${values[c].replace(/"/g, '""')}"`).join(",") + "\n";
    }
    count += rows.length;
    if (rows.length < PAGE) break;
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return {
    csv,
    count,
    columns: [...EXPORT_COLUMNS],
    filename: `bookings_export_${stamp}.csv`,
  };
}
