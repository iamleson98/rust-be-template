import { handleRouteError, requireUser, err } from "@/lib/api";
import { bookingOut, loadBooking } from "@/lib/services/booking-out";

/** `GET /api/bookings/{id}` — one ticket as `BookingOut` (with boarding QR). */
export async function GET(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    const row = await loadBooking(idOrCode, user.id);
    if (!row) return err(404, "not-found", "Booking not found");
    return Response.json(await bookingOut(row, { withQr: true }));
  } catch (e) {
    return handleRouteError(e);
  }
}
