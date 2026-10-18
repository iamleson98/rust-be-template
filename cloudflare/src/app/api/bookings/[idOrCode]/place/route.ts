import { handleRouteError, requireUser } from "@/lib/api";
import { placeBookingOnBoard } from "@/lib/services/booking";
import { loadBooking as load } from "@/lib/services/booking-out";

/** `POST /api/bookings/{id}/place` — COD placement (Rust `BookingConfirmResponse`). */
export async function POST(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    await placeBookingOnBoard(user.id, idOrCode);
    const row = await load(idOrCode, user.id);
    return Response.json({
      bookingId: row?.id ?? idOrCode,
      paymentMethod: row?.paymentMethod ?? "cod",
      status: row?.status ?? "confirmed",
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
