import { getDb } from "@/lib/db/client";
import { bookings, payments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, currentUser, err } from "@/lib/api";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser(req);
    const db = await getDb();
    const payment = (await db.select().from(payments).where(eq(payments.id, id)).limit(1))[0];
    if (!payment) return err(404, "not-found", "Payment not found");
    const booking = (
      await db.select().from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1)
    )[0];
    if (booking?.userId) {
      if (!user) return err(401, "unauthorized", "Login required");
      if (booking.userId !== user.id && user.role === "user")
        return err(403, "forbidden", "Not your payment");
    }
    return Response.json({
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      gatewayUrl: payment.gatewayUrl,
      qrPayload: payment.qrPayload,
      memo: payment.memo,
      providerTxnRef: payment.providerTxnRef,
      collectedAt: payment.collectedAt,
      createdAt: payment.createdAt,
      booking: booking ? { id: booking.id, code: booking.code, status: booking.status } : null,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
