import { parseSearchOptions, searchTrips } from "@/lib/services/trip-search";
import { handleRouteError, err } from "@/lib/api";
import { VIETNAMESE_CITIES } from "@/lib/cities";
import { CITY_COORDS } from "@/lib/city-coords";

/**
 * `GET /api/search/geo?fromLat=&fromLon=&toLat=&toLon=&date=…`
 * — geo trip search: nearest cities to both endpoints, then the regular
 * city-pair search with all the standard filters (Rust contract).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const num = (k: string) => Number(url.searchParams.get(k) ?? Number.NaN);
    const fromLat = num("fromLat");
    const fromLon = num("fromLon");
    const toLat = num("toLat");
    const toLon = num("toLon");
    if (![fromLat, fromLon, toLat, toLon].every((n) => Number.isFinite(n))) {
      return err(400, "validation", "fromLat, fromLon, toLat and toLon are required numbers");
    }
    const maxDistanceKm = Number(url.searchParams.get("maxDistanceKm") ?? "150");
    const from = nearestCity(fromLat, fromLon, maxDistanceKm);
    const to = nearestCity(toLat, toLon, maxDistanceKm);
    if (!from) return err(404, "not-found", "no city within maxDistanceKm of the departure point");
    if (!to) return err(404, "not-found", "no city within maxDistanceKm of the arrival point");
    if (from.id === to.id) {
      return Response.json({ items: [], total: 0, hasMore: false, limit: 0, offset: 0 });
    }

    // Re-parse the remaining filter params with from/to injected.
    const merged = new URL(url.searchParams.toString(), url.origin);
    merged.searchParams.set("from", from.id);
    merged.searchParams.set("to", to.id);
    const parsed = parseSearchOptions(merged);
    if ("error" in parsed) return err(400, "validation", parsed.error);
    const result = await searchTrips(parsed.from, parsed.to, parsed.opts);
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}

function nearestCity(lat: number, lon: number, maxKm: number) {
  let best: { id: string; name: string; km: number } | null = null;
  for (const city of VIETNAMESE_CITIES) {
    const coords = CITY_COORDS[city.id];
    if (!coords) continue;
    const km = haversineKm(lat, lon, coords.lat, coords.lon);
    if (km <= maxKm && (!best || km < best.km)) best = { id: city.id, name: city.name, km };
  }
  return best;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
