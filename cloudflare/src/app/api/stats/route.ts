import { handleRouteError } from "@/lib/api";
import { homeStats } from "@/lib/services/lookups";

/** `GET /api/stats` — public landing-page counters (30s cache-first read). */
export async function GET() {
  try {
    return Response.json(await homeStats());
  } catch (e) {
    return handleRouteError(e);
  }
}
