import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { badRequest, cancelBooking } from "@/lib/services/booking";

/** `POST /api/bookings/{id}/cancel` — the seats go back on sale; paid money is refunded at the policy rate. */
export async function POST(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    const body = await readJson<{ reason?: string | null }>(req).catch(() => ({
      reason: undefined as string | null | undefined,
    }));
    if (body.reason != null && body.reason.length > 1000)
      throw badRequest("reason has an invalid length");
    return Response.json(await cancelBooking(user.id, idOrCode, body.reason));
  } catch (e) {
    return handleRouteError(e);
  }
}
