import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { homeStats } from "@/lib/services/lookups";

/** `GET /api/stats` — active brands and routes, and the scheduled trips from today (Vietnam). */
export async function GET(req: Request) {
  try {
    return publicJson(req, await homeStats());
  } catch (e) {
    return handleRouteError(e);
  }
}
