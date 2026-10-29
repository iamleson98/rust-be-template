import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { queryReader } from "@/lib/query";
import { searchTripsGeo, type PlaceCities } from "@/lib/services/trip-geo";
import { parseSearchOptions } from "@/lib/services/trip-search-options";

/** Stops this close (km) count as near a searched place unless `maxDistanceKm` says otherwise. */
const DEFAULT_MAX_DISTANCE_KM = 50;

/**
 * `GET /api/search/geo?fromLat=&fromLon=&toLat=&toLon=&date=…` — trips that
 * stop near both places, in that order, nearest first by default (Rust
 * `GeoSearchQuery`); every filter of the city search applies. With
 * `fromCity` and `toCity` (the places' cities), every trip between those
 * cities too.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const q = queryReader(params);
    const from = [q.required.f64("fromLat"), q.required.f64("fromLon")] as const;
    const to = [q.required.f64("toLat"), q.required.f64("toLon")] as const;
    const maxDistanceKm = q.f64("maxDistanceKm") ?? DEFAULT_MAX_DISTANCE_KM;
    const fromCity = q.string("fromCity")?.trim();
    const toCity = q.string("toCity")?.trim();
    const cities: PlaceCities | null = fromCity && toCity ? { from: fromCity, to: toCity } : null;
    const opts = parseSearchOptions(params, true);
    return publicJson(req, await searchTripsGeo(from, to, maxDistanceKm, opts, cities));
  } catch (e) {
    return handleRouteError(e);
  }
}
