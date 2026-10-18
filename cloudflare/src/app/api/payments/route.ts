import { getDb } from "@/lib/db/client";
import { bookings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, clientIp, currentUser, readJson, err } from "@/lib/api";
import { createPayment, type Provider } from "@/lib/services/payment";

/**
 * POST /api/payments — create a payment intent.
 * MaybeAuth (guest payments allowed only for bookings without an owner —
 * matching the Rust MaybeAuthUser semantics).
 */
export async function POST(req: Request) {
  try {
    const user = await currentUser(req);
    const body = await readJson<{ bookingId?: string; provider?: string }>(req);
    if (!body.bookingId || !body.provider)
      return err(400, "validation", "bookingId and provider are required");
    const db = await getDb();
    const booking = (
      await db.select().from(bookings).where(eq(bookings.id, body.bookingId)).limit(1)
    )[0];
    if (!booking) return err(404, "not-found", "Booking not found");
    if (booking.userId) {
      if (!user) return err(401, "unauthorized", "Login required for this booking");
      if (booking.userId !== user.id) return err(403, "forbidden", "Not your booking");
    }
    const payment = await createPayment(db, {
      bookingId: body.bookingId,
      provider: body.provider as Provider,
      userId: user?.id ?? null,
      ip: clientIp(req),
    });
    const { paymentOut } = await import("@/lib/services/payment-out");
    return Response.json({ payment: await paymentOut(payment) }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
