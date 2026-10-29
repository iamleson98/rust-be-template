import { handleRouteError } from "@/lib/api";
import { queryReader } from "@/lib/query";
import { badRequest } from "@/lib/services/http-errors";
import { placeCacheControl, popularPlaces, searchPlaces } from "@/lib/services/place-search";

/**
 * `GET /api/places/search?q=&limit=&lat=&lon=` — place autocomplete. `limit`
 * defaults to 10, at most 50. `lat`+`lon` (optional, together) favour places
 * near that point, e.g. the map the user is looking at. A blank `q` lists the
 * popular places (the autocomplete shows them before the first keystroke).
 * `engine` says which index answered: "vps", or "static-shards" (fallback).
 */
export async function GET(req: Request) {
  try {
    const q = queryReader(new URL(req.url).searchParams);
    const text = q.required.string("q");
    const limit = Math.min(Math.max(q.u64("limit") ?? 10, 1), 50);
    const lat = q.f64("lat");
    const lon = q.f64("lon");
    if ((lat === undefined) !== (lon === undefined)) throw badRequest("lat and lon go together");
    const near = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
    const { items, engine } = text.trim()
      ? await searchPlaces(text, limit, near)
      : await popularPlaces(limit);
    return Response.json(
      { items, engine },
      { headers: { "cache-control": placeCacheControl(engine, 300) } },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
