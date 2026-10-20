/**
 * Pure shard builder: extractor NDJSON rows in, index files out. The CLI
 * (scripts/build-place-shards.ts) only does file I/O around this, which keeps
 * the interesting logic unit-testable inside workerd.
 */
import { VIETNAMESE_CITIES } from "@/lib/cities";
import { compact, fold, tokenize } from "./text";
import {
  BASE_KEY_LEN,
  INDEX_VERSION,
  cellKey,
  type Manifest,
  type PlaceRecord,
  type RawPlace,
} from "./format";

/** A key with more records than this is split by one more character. */
export const MAX_SHARD_RECORDS = 1200;
const MAX_KEY_LEN = 4;
const POPULAR_LIMIT = 50;
/** Two entries with the same name closer than this are the same place. */
const DUPLICATE_DEG = 0.1;
/** A province boundary's centroid sits far from its city's node: merge them anyway. */
const PROVINCE_TWIN_DEG = 1.0;

/** Higher wins when the same place appears as several OSM elements. */
const KIND_PRIORITY: Record<string, number> = {
  city: 10,
  town: 9,
  province: 8,
  train_station: 7,
  bus_station: 7,
  airport: 7,
  ferry_terminal: 6,
  district: 5,
  island: 4,
  attraction: 4,
  ward: 3,
  suburb: 3,
  village: 2,
  hamlet: 1,
};
const priority = (kind: string) => KIND_PRIORITY[kind] ?? 0;

/** Settlements and admin areas describe the same place; stations etc. do not. */
const AREA_KINDS = new Set([
  "city",
  "town",
  "province",
  "district",
  "ward",
  "suburb",
  "village",
  "hamlet",
  "island",
]);
const sameClass = (a: string, b: string) => (AREA_KINDS.has(a) && AREA_KINDS.has(b)) || a === b;

export interface BuiltIndex {
  /** Published path → file body. */
  files: Map<string, string>;
  manifest: Manifest;
  /** Rows discarded because they are not in a province the app serves. */
  dropped: number;
}

/** "Tỉnh An Giang" / "Thành phố Hà Nội" / "TP. Hồ Chí Minh" → "an giang" / … */
function provinceKey(name: string): string {
  return fold(name)
    .replace(/^(tinh|thanh pho|tp\.?)\s+/, "")
    .trim();
}

const PROVINCES = new Map(VIETNAMESE_CITIES.map((c) => [provinceKey(c.name), c.name]));

/**
 * The app's own spelling of a province (OSM says "Tỉnh Lâm Đồng", the city
 * list and the trip search say "Lâm Đồng"), or null when it is not one of
 * the 63 provinces — which is how foreign border areas in the extract and
 * unmappable points are recognised.
 */
export function canonicalProvince(name: string | null): string | null {
  return name ? (PROVINCES.get(provinceKey(name)) ?? null) : null;
}

/**
 * Rewrites province spellings to the app's own. A province that is not one of
 * ours stays `null` (and is filtered out after de-duplication, so a point
 * can still borrow its province from a twin element).
 */
function canonicalize(p: RawPlace): RawPlace | null {
  if (p.kind === "province") {
    const own = canonicalProvince(p.name);
    return own ? { ...p, name: own, province: own } : null;
  }
  return { ...p, province: canonicalProvince(p.province) };
}

function toRecord(p: RawPlace): PlaceRecord {
  return [
    `${p.osmType[0]}${p.osmId}`,
    p.name.trim(),
    p.kind,
    p.province ?? "",
    p.district ?? "",
    p.ward ?? "",
    Math.round(p.lat * 1e5) / 1e5,
    Math.round(p.lon * 1e5) / 1e5,
    p.population > 0 ? p.population : 0,
  ];
}

/**
 * The same city is usually both a `place=city` node and an administrative
 * relation (and sometimes a way too). Keep one entry per (name, area): the
 * highest-priority kind, carrying the largest population seen.
 */
export function dedupe(places: RawPlace[]): RawPlace[] {
  const byName = new Map<string, RawPlace[]>();
  for (const p of places) {
    const name = fold(p.name);
    if (!name || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const bucket = byName.get(name);
    if (bucket) bucket.push({ ...p });
    else byName.set(name, [{ ...p }]);
  }
  const kept: RawPlace[] = [];
  for (const group of byName.values()) {
    const survivors: RawPlace[] = [];
    // Best candidates first so they absorb the weaker duplicates.
    group.sort((a, b) => priority(b.kind) - priority(a.kind) || b.population - a.population);
    for (const p of group) {
      const twin = survivors.find((s) => {
        // A railway station called "Hà Nội" is not the city of Hà Nội.
        if (!sameClass(s.kind, p.kind)) return false;
        const reach =
          s.kind === "province" || p.kind === "province" ? PROVINCE_TWIN_DEG : DUPLICATE_DEG;
        return Math.abs(s.lat - p.lat) < reach && Math.abs(s.lon - p.lon) < reach;
      });
      if (twin) {
        twin.population = Math.max(twin.population, p.population);
        // The weaker element may know the address context the winner lacks.
        twin.province ??= p.province;
        twin.district ??= p.district;
        twin.ward ??= p.ward;
      } else {
        survivors.push(p);
      }
    }
    kept.push(...survivors);
  }
  // Deterministic output: identical input must give byte-identical files.
  return kept.sort((a, b) => a.osmType.localeCompare(b.osmType) || a.osmId - b.osmId);
}

/**
 * Tokens a record is findable by: its name's words, plus the whole name run
 * together so "hanoi" finds "Hà Nội" (people type it both ways).
 */
function nameKeyTokens(name: string): string[] {
  return [...new Set([...tokenize(name), compact(name)])].filter(Boolean);
}

/** Distinct leading-`len` prefixes of a record's key tokens. */
function keysOf(name: string, len: number): Set<string> {
  const keys = new Set<string>();
  for (const t of nameKeyTokens(name)) keys.add(t.slice(0, len));
  return keys;
}

export function buildIndex(raw: RawPlace[], builtAt = new Date().toISOString()): BuiltIndex {
  const canonical = raw.map(canonicalize).filter((p): p is RawPlace => p !== null);
  const merged = dedupe(canonical);
  const places = merged.filter((p) => p.province !== null);
  const dropped = raw.length - canonical.length + (merged.length - places.length);
  const records = places.map(toRecord);

  // ── search shards: 3-char prefixes, split to 4 where a key is too big ──
  const byKey = new Map<string, PlaceRecord[]>();
  const add = (key: string, rec: PlaceRecord) => {
    const list = byKey.get(key);
    if (list) list.push(rec);
    else byKey.set(key, [rec]);
  };
  for (const rec of records) for (const k of keysOf(rec[1], BASE_KEY_LEN)) add(k, rec);

  for (const [key, list] of [...byKey]) {
    if (list.length <= MAX_SHARD_RECORDS || key.length >= MAX_KEY_LEN) continue;
    // Tokens exactly as long as the key have no longer prefix: they stay.
    const stay: PlaceRecord[] = [];
    const split = new Map<string, PlaceRecord[]>();
    for (const rec of list) {
      let stays = false;
      for (const t of nameKeyTokens(rec[1])) {
        if (!t.startsWith(key)) continue;
        if (t.length <= key.length) {
          stays = true;
          continue;
        }
        const sub = t.slice(0, key.length + 1);
        const bucket = split.get(sub);
        if (!bucket) split.set(sub, [rec]);
        else if (bucket[bucket.length - 1] !== rec) bucket.push(rec);
      }
      if (stays) stay.push(rec);
    }
    byKey.delete(key);
    if (stay.length) byKey.set(key, stay);
    for (const [sub, recs] of split) byKey.set(sub, recs);
  }

  const files = new Map<string, string>();
  const keys: Record<string, number> = {};
  for (const [key, list] of [...byKey].sort(([a], [b]) => a.localeCompare(b))) {
    keys[key] = list.length;
    files.set(`s/${key}.json`, JSON.stringify(list));
  }

  // ── geo cells ──
  const cells = new Map<string, PlaceRecord[]>();
  for (const rec of records) {
    const key = cellKey(rec[6], rec[7]);
    const list = cells.get(key);
    if (list) list.push(rec);
    else cells.set(key, [rec]);
  }
  for (const [key, list] of cells) files.set(`g/${key}.json`, JSON.stringify(list));

  // ── popular: the biggest cities and towns (default autocomplete list) ──
  const popular = records
    .filter((r) => r[2] === "city" || r[2] === "town")
    .sort(
      (a, b) => b[8] - a[8] || priority(b[2]) - priority(a[2]) || a[1].localeCompare(b[1], "vi"),
    )
    .slice(0, POPULAR_LIMIT);
  files.set("popular.json", JSON.stringify(popular));

  const manifest: Manifest = {
    v: INDEX_VERSION,
    builtAt,
    count: records.length,
    keys,
    cells: [...cells.keys()].sort(),
  };
  files.set("manifest.json", JSON.stringify(manifest));
  return { files, manifest, dropped };
}
