import { handleRouteError, requireUser } from "@/lib/api";
import { placeCash } from "@/lib/services/booking";

/**
 * `POST /api/bookings/{id}/place` — pay on board: the booking is placed and
 * its seats held until departure while the operator phones the customer to
 * confirm it. Online payments go through `/api/payments`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    return Response.json(await placeCash(user.id, idOrCode));
  } catch (e) {
    return handleRouteError(e);
  }
}
