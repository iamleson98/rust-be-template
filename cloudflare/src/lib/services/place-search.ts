/**
 * Place search. Primary: the VPS service (`vps/`), an in-memory index of
 * every named place in Vietnam with typo tolerance, intent and context
 * ranking, rebuilt weekly from OpenStreetMap. Fallback: the static shard
 * index shipped with the deploy (`/places/*`, built by the weekly CI job),
 * used when the VPS is not configured or does not answer in time.
 *
 * Callers learn which engine answered, so a degraded answer is cached briefly.
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
import { vpsGet, vpsConfigured, VpsUnavailable, type VpsEnv } from "@/lib/vps";

export type { PlaceHit };

export type PlaceEngine = "vps" | "static-shards";

export interface PlaceResult {
  items: PlaceHit[];
  engine: PlaceEngine;
}

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

async function vpsEnv(): Promise<VpsEnv> {
  return (await getCloudflareContext({ async: true })).env;
}

/**
 * Asks the VPS, else the static index. `ask` returns null when the VPS is
 * not set up, so an unconfigured deploy never logs a warning per request.
 */
async function withFallback(
  ask: (env: VpsEnv) => Promise<PlaceHit[]> | null,
  fallback: () => Promise<PlaceHit[]>,
): Promise<PlaceResult> {
  const env = await vpsEnv();
  const pending = vpsConfigured(env) ? ask(env) : null;
  if (pending) {
    try {
      return { items: await pending, engine: "vps" };
    } catch (e) {
      if (!(e instanceof VpsUnavailable) || e.message !== "recently unreachable") {
        console.warn(`[places] VPS search unavailable, using the static index: ${String(e)}`);
      }
    }
  }
  return { items: await fallback(), engine: "static-shards" };
}

const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export async function searchPlaces(
  raw: string,
  limit = 10,
  near?: { lat: number; lon: number },
): Promise<PlaceResult> {
  return withFallback(
    async (env) =>
      (
        await vpsGet<{ items: PlaceHit[] }>(
          env,
          `/v1/places/search?${query({ q: raw, limit, lat: near?.lat, lon: near?.lon })}`,
        )
      ).items,
    async () => searchIndex(await getLoader(), raw, limit),
  );
}

/** Popular places for the default autocomplete list. */
export async function popularPlaces(limit = 20, offset = 0): Promise<PlaceResult> {
  return withFallback(
    async (env) =>
      (await vpsGet<{ items: PlaceHit[] }>(env, `/v1/places/popular?${query({ limit, offset })}`))
        .items,
    async () => (await popularIndex(await getLoader(), offset + limit)).slice(offset),
  );
}

/** Reverse geocode: nearest indexed places to a point. */
export async function reverseGeocode(lat: number, lon: number, limit = 5): Promise<PlaceResult> {
  return withFallback(
    (env) => vpsGet<PlaceHit[]>(env, `/v1/places/reverse?${query({ lat, lon, limit })}`),
    async () => reverseIndex(await getLoader(), lat, lon, limit),
  );
}

/** Browser + edge cache lifetime: a degraded answer is not kept long. */
export function placeCacheControl(engine: PlaceEngine, maxAge: number): string {
  return `public, max-age=${engine === "vps" ? maxAge : Math.min(maxAge, 60)}`;
}
