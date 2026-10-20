import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, currentUser, readJson } from "@/lib/api";
import { createPayment } from "@/lib/services/payment";
import { badRequest } from "@/lib/services/booking";

/**
 * `POST /api/payments` — create a payment intent for a pending booking.
 * Signed-out callers may only pay a booking without an owner (legacy guest
 * bookings); an owned booking answers 401 to them.
 */
export async function POST(req: Request) {
  try {
    const user = await currentUser(req);
    const body = await readJson<{ bookingId?: string; provider?: string }>(req);
    if (typeof body.bookingId !== "string" || typeof body.provider !== "string")
      throw badRequest("bookingId and provider are required");
    // Guests can pay too: key by the user, else by the booking being paid.
    await limitWrite("payment", user?.id ?? body.bookingId);
    return Response.json(
      await createPayment({ bookingId: body.bookingId, provider: body.provider }, user?.id ?? null),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
