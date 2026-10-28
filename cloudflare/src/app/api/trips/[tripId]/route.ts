import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { uuidParam } from "@/lib/query";
import { tripDetail } from "@/lib/services/trip-detail";

/** `GET /api/trips/{id}` — the full trip detail with its seat map. */
export async function GET(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  try {
    const { tripId } = await ctx.params;
    return publicJson(req, await tripDetail(uuidParam(tripId, "id")));
  } catch (e) {
    return handleRouteError(e);
  }
}
