import { handleRouteError, currentUser } from "@/lib/api";
import { getPayment } from "@/lib/services/payment";

/** `GET /api/payments/{id}` — one payment; the caller must own its booking. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser(req);
    return Response.json(await getPayment(id, user?.id ?? null));
  } catch (e) {
    return handleRouteError(e);
  }
}
