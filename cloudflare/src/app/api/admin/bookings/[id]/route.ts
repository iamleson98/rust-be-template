import { getDb, atomicBatch } from "@/lib/db/client";
import { bookingSeats } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { loadBooking, bookingOut } from "@/lib/services/booking-out";

type Params = { params: Promise<{ id: string }> };

/** `GET /api/admin/bookings/{id}` — admin booking detail. */
export async function GET(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:read");
    const { id } = await ctx.params;
    const row = await loadBooking(id);
    if (!row) return err(404, "not-found", "booking not found");
    const out = await bookingOut(row);
    return Response.json({ item: out });
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * `PATCH /api/admin/bookings/{id}` — confirm (after phoning the customer),
 * complete or cancel a ticket. Completed and cancelled tickets are final.
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:write");
    const { id } = await ctx.params;
    const body = await readJson<{ status?: string; reason?: string | null }>(req);
    const status = body.status ?? "";
    if (!["confirmed", "completed", "cancelled"].includes(status)) {
      return err(400, "validation", "status must be confirmed, completed or cancelled");
    }
    const db = await getDb();
    const row = await loadBooking(id);
    if (!row) return err(404, "not-found", "booking not found");
    if (row.status === "cancelled" || row.status === "completed") {
      return err(409, "conflict", "Completed and cancelled tickets are final");
    }
    if (status === "confirmed" && row.status !== "pending") {
      return err(409, "conflict", "Only pending bookings can be confirmed");
    }
    if (status === "completed" && row.status !== "confirmed") {
      return err(409, "conflict", "Only confirmed bookings can be completed");
    }

    const now = new Date().toISOString();
    if (status === "confirmed") {
      // Paying the ticket: its coupon becomes payable (`reserved → redeemed`)
      // and the owner may claim again (same cascade as payment completion).
      await atomicBatch([
        sql`UPDATE booking SET status = 'confirmed', updated_at = ${now} WHERE id = ${row.id}`,
        sql`
          UPDATE seat_inventory SET status = 'booked', held_until = NULL, updated_at = ${now}
          WHERE held_by_booking_id = ${row.id} AND status = 'held'
        `,
        sql`UPDATE payment SET status = 'completed', updated_at = ${now} WHERE booking_id = ${row.id} AND status = 'pending'`,
        sql`
          UPDATE coupon SET status = 'redeemed', active_holder = NULL, redeemed_at = ${now},
                 updated_at = ${now}
          WHERE booking_id = ${row.id} AND status = 'reserved'
        `,
      ]);
    } else if (status === "completed") {
      await atomicBatch([
        sql`UPDATE booking SET status = 'completed', updated_at = ${now} WHERE id = ${row.id}`,
      ]);
    } else {
      // cancelled — free the seats + cancel payments + return the coupon
      // (to its owner while still valid, else expired).
      const seatCount = (
        await db.select({ n: sql<number>`count(*)` }).from(bookingSeats).where(sql`booking_id = ${row.id}`)
      )[0];
      await atomicBatch([
        sql`UPDATE booking SET status = 'cancelled', updated_at = ${now} WHERE id = ${row.id}`,
        sql`
          UPDATE seat_inventory SET status = 'available', held_by_booking_id = NULL, held_until = NULL, updated_at = ${now}
          WHERE trip_session_id = ${row.tripSessionId}
            AND seat_id IN (SELECT seat_id FROM booking_seat WHERE booking_id = ${row.id})
        `,
        sql`
          UPDATE trip_session SET available_seats = available_seats + ${Number(seatCount?.n ?? 0)}, updated_at = ${now}
          WHERE id = ${row.tripSessionId}
        `,
        sql`UPDATE payment SET status = 'cancelled', updated_at = ${now} WHERE booking_id = ${row.id} AND status = 'pending'`,
        sql`UPDATE payment SET status = 'refunded', updated_at = ${now} WHERE booking_id = ${row.id} AND status = 'completed'`,
        sql`UPDATE coupon SET status = 'held', booking_id = NULL, brand_id = NULL, reserved_at = NULL,
               updated_at = ${now}
          WHERE booking_id = ${row.id} AND status = 'reserved'
            AND (valid_until IS NULL OR valid_until > ${now})`,
        sql`UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
          WHERE booking_id = ${row.id} AND status = 'reserved'`,
      ]);
    }

    const updated = await loadBooking(id);
    const out = await bookingOut(updated ?? row);
    return Response.json({ item: out });
  } catch (e) {
    return handleRouteError(e);
  }
}
