import { handleRouteError, requireUser, err } from "@/lib/api";
import { getBookingForUser } from "@/lib/services/booking";

export async function GET(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    const found = await getBookingForUser(user.id, idOrCode);
    if (!found) return err(404, "not-found", "Booking not found");
    return Response.json({
      booking: found.booking,
      seats: found.seats,
      trip: found.trip,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
