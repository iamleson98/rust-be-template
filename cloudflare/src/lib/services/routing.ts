/**
 * Routing proxy — port of `routing_service.rs` and `routes/routing.rs`:
 * directions, distance matrix and isochrones from a Valhalla server,
 * reshaped for the map UI. Without `VALHALLA_URL` every call fails like
 * Rust's does ("not configured"), which the UI treats as "no routing".
 */
import { getEnv } from "@/lib/db/client";
import { ApiError } from "@/lib/auth/rbac";
import { badRequest } from "@/lib/services/http-errors";

export type LatLon = readonly [lat: number, lon: number];

const TIMEOUT_MS = 15_000;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const internal = (message: string) => new ApiError(500, "internal", message);
/** Improvement on Rust (500): a missing optional service is "unavailable", not a server fault. */
const unavailable = (message: string) => new ApiError(503, "unavailable", message);

/** Rust `parse_locs`: `lat,lon;lat,lon` (empty segments skipped, extra coordinates ignored). */
export function parseLocations(raw: string): LatLon[] {
  return raw
    .split(";")
    .filter((p) => p !== "")
    .map((p) => {
      const [lat, lon] = p.split(",");
      if (lat === undefined) throw badRequest("bad loc");
      if (!NUMBER.test(lat.trim())) throw badRequest("bad lat");
      if (lon === undefined) throw badRequest("bad loc");
      if (!NUMBER.test(lon.trim())) throw badRequest("bad lon");
      return [Number(lat.trim()), Number(lon.trim())] as const;
    });
}

/** `contours=15,30,60` in minutes; entries that are not whole numbers are dropped. */
export function parseContours(raw: string | null): number[] {
  if (raw === null) return [15, 30, 60];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map(Number);
}

const point = ([lat, lon]: LatLon) => ({ lat, lon });

async function callValhalla(endpoint: string, body: unknown): Promise<Record<string, unknown>> {
  const base = (await getEnv()).VALHALLA_URL;
  if (!base) throw unavailable("Valhalla routing service not configured. Set VALHALLA_URL.");
  let res: Response;
  try {
    res = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw internal(`Valhalla request failed: ${String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) throw internal(`Valhalla returned ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw internal(`Valhalla response parse failed: ${String(e)}`);
  }
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export async function directions(costing: string, language: string, locations: LatLon[]) {
  if (locations.length < 2) throw badRequest("at least 2 locations required");
  const v = await callValhalla("/route", {
    costing,
    language,
    locations: locations.map(point),
    directions_options: { units: "kilometers" },
  });
  const trip = (v.trip ?? null) as {
    summary?: { length?: unknown; time?: unknown };
    shape?: unknown;
  } | null;
  return {
    valhalla: trip,
    ...(typeof trip?.shape === "string" && { shape: trip.shape }),
    distanceKm: num(trip?.summary?.length) ?? 0,
    timeMin: (num(trip?.summary?.time) ?? 0) / 60,
  };
}

export async function matrix(costing: string, sources: LatLon[], targets: LatLon[]) {
  if (sources.length === 0 || targets.length === 0)
    throw badRequest("at least 1 source and 1 target required");
  const v = await callValhalla("/sources_to_targets", {
    costing,
    sources: sources.map(point),
    targets: targets.map(point),
    units: "kilometers",
  });
  const rows = Array.isArray(v.sources_to_targets) ? (v.sources_to_targets as unknown[]) : [];
  const cells = rows.map((row) =>
    Array.isArray(row) ? (row as { time?: unknown; distance?: unknown }[]) : [],
  );
  return {
    timesMin: cells.map((row) => row.map((c) => (num(c.time) === null ? null : num(c.time)! / 60))),
    distancesKm: cells.map((row) => row.map((c) => num(c.distance))),
  };
}

export async function isochrone(costing: string, center: LatLon, contoursMin: number[]) {
  if (contoursMin.length === 0) throw badRequest("at least 1 contour time required");
  const geojson = await callValhalla("/isochrone", {
    costing,
    locations: [point(center)],
    contours: contoursMin.map((time) => ({ time })),
    polygons: true,
  });
  return { geojson };
}
