import { handleRouteError, currentUser } from "@/lib/api";
import { listBookingPayments } from "@/lib/services/payment";

/** `GET /api/payments/booking/{bookingId}` — a booking's payments, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await ctx.params;
    const user = await currentUser(req);
    return Response.json(await listBookingPayments(bookingId, user?.id ?? null));
  } catch (e) {
    return handleRouteError(e);
  }
}
