import { parseSearchOptions, searchTrips } from "@/lib/services/trip-search";
import { handleRouteError, err } from "@/lib/api";

/** `GET /api/search` — city-pair trip search (Rust contract: camelCase params). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = parseSearchOptions(url);
    if ("error" in parsed) return err(400, "validation", parsed.error);
    const result = await searchTrips(parsed.from, parsed.to, parsed.opts);
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}
