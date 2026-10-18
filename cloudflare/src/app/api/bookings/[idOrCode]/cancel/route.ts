import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { cancelBooking } from "@/lib/services/booking";

/** `POST /api/bookings/{id}/cancel` — Rust `BookingCancelResponse`. */
export async function POST(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    const body = await readJson<{ reason?: string | null }>(req).catch(() => ({
      reason: undefined,
    }));
    const result = await cancelBooking(user.id, idOrCode);
    return Response.json({
      success: true,
      refCode: result.refCode,
      refundPercent: result.refundPercent,
      refundAmount: result.refundAmount,
      cancelledAt: new Date().toISOString(),
      reason: body.reason ?? null,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
