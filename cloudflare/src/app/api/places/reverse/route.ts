import { handleRouteError } from "@/lib/api";
import { queryReader } from "@/lib/query";
import { reverseGeocode } from "@/lib/services/place-search";

/**
 * `GET /api/places/reverse?lat=&lon=&limit=` — the nearest places, nearest
 * first, as a bare array (the SDK's `PlacesReverseResponse`). `limit`
 * defaults to 10, at most 50.
 */
export async function GET(req: Request) {
  try {
    const q = queryReader(new URL(req.url).searchParams);
    const lat = q.required.f64("lat");
    const lon = q.required.f64("lon");
    const limit = Math.min(Math.max(q.u64("limit") ?? 10, 1), 50);
    return Response.json(await reverseGeocode(lat, lon, limit), {
      headers: { "cache-control": "public, max-age=3600" },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
