import { recommendationTrips } from "@/lib/services/trip-search";
import { handleRouteError } from "@/lib/api";

/** `GET /api/recommendations` — up to 4 upcoming trips (Rust contract). */
export async function GET() {
  try {
    return Response.json(await recommendationTrips());
  } catch (e) {
    return handleRouteError(e);
  }
}
