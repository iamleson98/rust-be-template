/**
 * On-disk format of the static place index (version 1).
 *
 *   places/manifest.json   { v, builtAt, count, keys, cells }
 *   places/s/<key>.json    search shard: records whose NAME has a token that
 *                          starts with <key>  (1–4 chars, see build.ts)
 *   places/g/<cell>.json   geo cell (CELL_DEG°): every record inside it
 *   places/popular.json    the default autocomplete list
 *
 * Records are positional arrays — the shards are the bulk of the deploy, and
 * JSON keys would double their size.
 */

export const INDEX_VERSION = 1;

/** Search shards are keyed by this many leading characters (shorter tokens key as themselves). */
export const BASE_KEY_LEN = 3;

/** Geo cell edge in degrees (~27 km): reverse geocoding reads a 3×3 block. */
export const CELL_DEG = 0.25;

/** [id, name, kind, province, district, ward, lat, lon, population] */
export type PlaceRecord = [
  id: string,
  name: string,
  kind: string,
  province: string,
  district: string,
  ward: string,
  lat: number,
  lon: number,
  population: number,
  /** Other names for the same place, `;`-separated ("" when none). */
  alt: string,
];

/** One line of the extractor's NDJSON (tools/place-extract). */
export interface RawPlace {
  osmId: number;
  osmType: "node" | "way" | "relation";
  kind: string;
  name: string;
  /** Other names for the same place (searchable, never displayed). */
  altNames?: string[];
  province: string | null;
  district: string | null;
  ward: string | null;
  lat: number;
  lon: number;
  population: number;
}

export interface Manifest {
  v: number;
  builtAt: string;
  count: number;
  /** Search shard key → record count. */
  keys: Record<string, number>;
  /** Non-empty geo cells ("<latIdx>_<lonIdx>"). */
  cells: string[];
}

export function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;
}
