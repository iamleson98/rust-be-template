import { handleRouteError, requireUser } from "@/lib/api";
import { ownedBooking } from "@/lib/services/booking";
import { bookingView } from "@/lib/services/booking-out";

/** `GET /api/bookings/{id}` — one of the customer's tickets, by id or code, with its boarding QR. */
export async function GET(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    return Response.json(await bookingView(await ownedBooking(user.id, idOrCode)));
  } catch (e) {
    return handleRouteError(e);
  }
}
