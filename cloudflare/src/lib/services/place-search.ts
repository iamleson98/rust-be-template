/**
 * Place search — static shard index (replaces the D1 FTS5 port of Tantivy).
 *
 * The index is built weekly by CI from the Geofabrik Vietnam extract
 * (tools/place-extract → scripts/build-place-shards.ts) and ships with the
 * deploy as static assets under /places/. Reading it costs no D1 rows and
 * needs no container: the Worker fetches the one or two small shard files a
 * query needs through the ASSETS binding and keeps them in a bounded
 * per-isolate cache.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  cachedLoader,
  popularIndex,
  reverseIndex,
  searchIndex,
  type Loader,
  type PlaceHit,
} from "@/lib/places/search";

export type { PlaceHit };

let loader: Loader | null = null;

/** Per-isolate loader over the ASSETS binding (global fetch under `next dev`). */
async function getLoader(): Promise<Loader> {
  if (loader) return loader;
  const { env } = await getCloudflareContext({ async: true });
  const origin = "https://assets.invalid";
  const devOrigin = process.env.PLACES_DEV_ORIGIN ?? "http://localhost:3000";
  loader = cachedLoader(async (path) => {
    const res = env.ASSETS
      ? await env.ASSETS.fetch(new Request(`${origin}/places/${path}`))
      : await fetch(`${devOrigin}/places/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`place index ${path}: HTTP ${res.status}`);
    return res.json();
  });
  return loader;
}

export async function searchPlaces(raw: string, limit = 10): Promise<PlaceHit[]> {
  return searchIndex(await getLoader(), raw, limit);
}

/** Popular places for the default autocomplete list. */
export async function popularPlaces(limit = 20): Promise<PlaceHit[]> {
  return popularIndex(await getLoader(), limit);
}

/** Reverse geocode: nearest indexed places to a point. */
export async function reverseGeocode(lat: number, lon: number, limit = 5): Promise<PlaceHit[]> {
  return reverseIndex(await getLoader(), lat, lon, limit);
}
