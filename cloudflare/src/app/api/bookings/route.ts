import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { createBooking, type HoldRequest } from "@/lib/services/booking";
import { bookingViews, listBookings } from "@/lib/services/booking-out";

/**
 * `GET /api/bookings` — the customer's tickets (bookings they placed or
 * paid for, so cancelled and completed ones too; checkouts never finished
 * are not tickets), newest first.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const num = (key: string, fallback: number) => {
      const n = Number(url.searchParams.get(key));
      return url.searchParams.has(key) && Number.isInteger(n) && n >= 0 ? n : fallback;
    };
    const limit = Math.min(num("limit", 50), 200);
    const rows = await listBookings({ userId: user.id, placed: true }, limit, num("offset", 0));
    return Response.json({ items: await bookingViews(rows) });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/bookings` (and `/api/bookings/hold`) — hold seats → pending booking. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("booking", user.id);
    const body = await readJson<HoldRequest>(req);
    const held = await createBooking(user.id, body);
    return Response.json({ ...held, couponId: held.couponId ?? undefined });
  } catch (e) {
    return handleRouteError(e);
  }
}
