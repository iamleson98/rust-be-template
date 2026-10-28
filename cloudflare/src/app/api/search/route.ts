import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { queryReader } from "@/lib/query";
import { searchTrips } from "@/lib/services/trip-search";
import { parseSearchOptions } from "@/lib/services/trip-search-options";

/** `GET /api/search` — city-pair trip search (camelCase query, as the Rust `SearchTripsQuery`). */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const q = queryReader(params);
    const from = q.required.string("from");
    const to = q.required.string("to");
    return publicJson(req, await searchTrips(from, to, parseSearchOptions(params, false)));
  } catch (e) {
    return handleRouteError(e);
  }
}
