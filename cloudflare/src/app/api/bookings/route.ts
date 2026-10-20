import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { createBooking, type HoldRequest } from "@/lib/services/booking";
import { bookingOut, loadBookings } from "@/lib/services/booking-out";

/** `GET /api/bookings` — own tickets (placed/confirmed only), newest first. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const rows = await loadBookings(user.id, limit, offset);
    const items = await Promise.all(
      rows
        .filter((b) => b.status === "pending" || b.status === "confirmed")
        .map((b) => bookingOut(b)),
    );
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/bookings` — hold seats → pending booking (Rust `BookingHoldResponse`). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("booking", user.id);
    const body = await readJson<HoldRequest>(req);
    const result = await createBooking(user.id, body);
    const out = await bookingOut(result.booking);
    return Response.json(
      {
        bookingId: result.booking.id,
        code: result.booking.code,
        status: result.booking.status,
        subtotal: result.booking.subtotal,
        discount: result.booking.discount,
        fees: result.booking.fees,
        total: result.booking.total,
        expiresAt: result.booking.expiresAt ?? new Date().toISOString(),
        couponId: result.couponId ?? null,
        seats: out.seats,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
