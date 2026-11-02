import { handleRouteError, requireUser, type IdParams } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import { cancelPriceAlert } from "@/lib/services/price-alerts";

/** `DELETE /api/price-alerts/{id}` — cancel (soft-delete) an alert; answers the cancelled alert. */
export async function DELETE(req: Request, ctx: IdParams) {
  try {
    const user = await requireUser(req);
    const id = uuidParam("id", (await ctx.params).id) as string;
    return Response.json(await cancelPriceAlert(id, user.id));
  } catch (e) {
    return handleRouteError(e);
  }
}
