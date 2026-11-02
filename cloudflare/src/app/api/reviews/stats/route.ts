import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { uuidParam } from "@/lib/services/http-errors";
import { reviewStats } from "@/lib/services/reviews";

/** `GET /api/reviews/stats` — count, average, stars and top tags of a brand's and/or route's approved reviews. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return publicJson(
      req,
      await reviewStats(
        uuidParam("brand_id", q.get("brand_id")),
        uuidParam("route_id", q.get("route_id")),
      ),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
