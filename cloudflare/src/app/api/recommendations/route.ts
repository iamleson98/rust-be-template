import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { recommendedTrips } from "@/lib/services/trip-recommendations";

/** `GET /api/recommendations` — up to 4 upcoming trips with seats left. */
export async function GET(req: Request) {
  try {
    return publicJson(req, await recommendedTrips());
  } catch (e) {
    return handleRouteError(e);
  }
}
