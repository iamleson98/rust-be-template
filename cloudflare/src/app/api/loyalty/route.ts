import { handleRouteError, requireUser } from "@/lib/api";
import { loyaltySummary } from "@/lib/services/loyalty";

/** `GET /api/loyalty` — points, tier and earning history derived from the caller's completed bookings. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json(await loyaltySummary(user.id));
  } catch (e) {
    return handleRouteError(e);
  }
}
