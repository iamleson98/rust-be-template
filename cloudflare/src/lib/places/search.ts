/**
 * Place search over the static shard index (see format.ts). Runs in the
 * Worker, reads only the one-to-few small JSON shards a query needs, and
 * needs no database, container or native binary.
 */
import { compact, expandAbbreviations, fold, tokenize } from "./text";
import { BASE_KEY_LEN, CELL_DEG, cellKey, type Manifest, type PlaceRecord } from "./format";

export interface PlaceHit {
  id: string;
  name: string;
  nameNoTones: string | null;
  type: string;
  province: string | null;
  district: string | null;
  ward: string | null;
  lat: number;
  lon: number;
  score: number;
}

/** Fetches one index file (path relative to places/); `null` when absent. */
export type Loader = (path: string) => Promise<unknown | null>;

const KIND_BOOST: Record<string, number> = {
  city: 4,
  town: 3.6,
  province: 3,
  train_station: 3.2,
  bus_station: 3.2,
  airport: 3.2,
  ferry_terminal: 2.6,
  district: 2,
  island: 1.8,
  attraction: 1.6,
  ward: 1.5,
  village: 1.2,
  suburb: 1.1,
  hamlet: 1.0,
};

const MAX_QUERY_TOKENS = 6;
/** Query tokens whose shards are read (longest first); results are the union. */
const MAX_LOOKUPS = 4;
/** Shards fetched for one lookup token (a 1–2 letter token spans many keys). */
const MAX_SHARDS = 6;
/**
 * Words that describe the TYPE of place ("Ga", "Bến xe", "Phường"). People
 * type them whether or not OSM's name does ("ga hà nội" vs the station
 * mapped as "Hà Nội"), so a record need not match them — they only help
 * ranking. A query made of nothing but these still requires all of them.
 */
const GENERIC = new Set([
  "ga",
  "ben",
  "xe",
  "san",
  "bay",
  "cang",
  "thanh",
  "pho",
  "tinh",
  "phuong",
  "xa",
  "quan",
  "huyen",
  "thi",
  "tran",
  "tp",
  "tx",
  "tt",
]);
/** Reverse geocoding answers "where am I": areas, not landmarks. */
const AREA_KINDS = new Set([
  "city",
  "town",
  "suburb",
  "village",
  "hamlet",
  "ward",
  "district",
  "island",
]);
/** Beyond this reverse-geocode distance there is no meaningful "nearest". */
const MAX_REVERSE_DEG = 0.5;

/**
 * Wraps a loader with a bounded per-isolate cache. Index files are immutable
 * for the life of a deploy, so a hit never needs revalidating; failures are
 * not cached.
 */
export function cachedLoader(inner: Loader, maxEntries = 64): Loader {
  const cache = new Map<string, Promise<unknown | null>>();
  return (path) => {
    const hit = cache.get(path);
    if (hit) {
      // Refresh recency.
      cache.delete(path);
      cache.set(path, hit);
      return hit;
    }
    const pending = inner(path).then(
      (value) => {
        if (value === null) cache.delete(path);
        return value;
      },
      (e) => {
        cache.delete(path);
        throw e;
      },
    );
    cache.set(path, pending);
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
    return pending;
  };
}

async function loadManifest(load: Loader): Promise<Manifest | null> {
  const m = (await load("manifest.json")) as Manifest | null;
  return m && typeof m === "object" && m.keys ? m : null;
}

/** Shard keys that can hold records for a query token, biggest first. */
export function candidateKeys(keys: Record<string, number>, token: string): string[] {
  return Object.keys(keys)
    .filter((k) => {
      if (token.length < k.length) return k.startsWith(token);
      // Keys shorter than BASE_KEY_LEN hold only tokens that ARE the key, so
      // a longer query token cannot be a prefix of anything in them.
      return k.length < BASE_KEY_LEN ? token === k : token.startsWith(k);
    })
    .sort((a, b) => keys[b] - keys[a])
    .slice(0, MAX_SHARDS);
}

interface Candidate {
  rec: PlaceRecord;
  nameTokens: string[];
  ctxTokens: string[];
}

function toCandidate(rec: PlaceRecord): Candidate {
  return {
    rec,
    nameTokens: tokenize(rec[1]),
    ctxTokens: tokenize(`${rec[3]} ${rec[4]} ${rec[5]}`),
  };
}

/** Best match of one query token against a record, or -1 when it matches nothing. */
function tokenScore(qt: string, c: Candidate): number {
  let best = -1;
  for (const t of c.nameTokens) {
    if (t === qt) return 3;
    if (t.startsWith(qt)) best = Math.max(best, 2);
  }
  for (const t of c.ctxTokens) {
    if (t === qt) best = Math.max(best, 1);
    else if (t.startsWith(qt)) best = Math.max(best, 0.5);
  }
  return best;
}

function toHit(rec: PlaceRecord, score: number): PlaceHit {
  return {
    id: rec[0],
    name: rec[1],
    nameNoTones: fold(rec[1]),
    type: rec[2],
    province: rec[3] || null,
    district: rec[4] || null,
    ward: rec[5] || null,
    lat: rec[6],
    lon: rec[7],
    score,
  };
}

export async function searchIndex(load: Loader, raw: string, limit = 10): Promise<PlaceHit[]> {
  const tokens = tokenize(expandAbbreviations(raw)).slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return [];
  const manifest = await loadManifest(load);
  if (!manifest) return [];

  const meaningful = tokens.filter((t) => !GENERIC.has(t));
  const required = meaningful.length > 0 ? meaningful : tokens;
  const queryFold = tokens.join(" ");
  // The run-together form ("hanoi") is a match and a lookup key too, so
  // "ha noi" and "hanoi" read the same shards.
  const queryCompact = required.join("");

  // Every record that matches by name carries one of the query words, so the
  // shards of the longest few words (plus the run-together form) cover them
  // all. Read them in parallel and score the union: stopping at the first
  // shard with any hit would return context-only matches ("ho chi minh" →
  // every place inside Hồ Chí Minh) ahead of the city itself.
  // Required words first (longest = most selective), then the type words:
  // a bus station matches "bến xe hà nội" by NAME on "bến xe" and only by
  // address context on "hà nội".
  const byLength = (a: string, b: string) => b.length - a.length;
  const ordered = [
    ...new Set([
      ...[...required, queryCompact].filter(Boolean).sort(byLength),
      ...tokens.filter((t) => !required.includes(t)).sort(byLength),
    ]),
  ];
  // One- and two-letter words ("ha", "sa") span dozens of shards and select
  // nothing; the run-together form ("hanoi") already covers them.
  const selective = ordered.filter((t) => t.length >= BASE_KEY_LEN);
  const lookups = (selective.length > 0 ? selective : ordered).slice(0, MAX_LOOKUPS);
  const files = [...new Set(lookups.flatMap((t) => candidateKeys(manifest.keys, t)))];
  const shards = await Promise.all(files.map((k) => load(`s/${k}.json`)));

  const seen = new Set<string>();
  const scored: Array<PlaceHit & { typed: number }> = [];
  for (const shard of shards) {
    for (const rec of (shard as PlaceRecord[] | null) ?? []) {
      if (seen.has(rec[0])) continue;
      seen.add(rec[0]);
      const c = toCandidate(rec);
      let match = 0;
      let inName = 0; // required words found in the NAME (not just the address)
      let typed = 0; // type words ("bến xe") this record actually matches
      let ok = true;
      for (const qt of tokens) {
        const s = tokenScore(qt, c);
        if (s >= 0) {
          match += s;
          if (s >= 2 && !GENERIC.has(qt)) inName++;
          if (GENERIC.has(qt)) typed++;
        } else if (!GENERIC.has(qt) || meaningful.length === 0) {
          ok = false;
          break;
        }
      }
      // "hanoi" / "bennghe": the query is a prefix of the name run together.
      if (!ok && queryCompact.length >= 3 && compact(rec[1]).startsWith(queryCompact)) {
        ok = true;
        match = 2.5 * tokens.length;
      }
      if (!ok) continue;
      const nameFold = c.nameTokens.join(" ");
      let score = (KIND_BOOST[rec[2]] ?? 1) + match / tokens.length;
      if (compact(rec[1]) === compact(raw)) score += 6;
      // Exact on the meaningful words only: a lesser bonus when the query also
      // asked for a type ("ga hà nội" → the city is not the station).
      else if (compact(rec[1]) === queryCompact) score += meaningful.length < tokens.length ? 2 : 6;
      else if (nameFold.startsWith(queryFold)) score += 2;
      score += typed * 3.5; // honours "bến xe" / "ga" / "sân bay"
      if (meaningful.length > 0 && inName === meaningful.length) score += 2;
      score -= 0.02 * c.nameTokens.length;
      score += Math.min(Math.log10(rec[8] + 1) / 3, 2);
      scored.push({ ...toHit(rec, score), typed });
    }
  }
  return scored
    .map(({ typed: _typed, ...hit }) => hit)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export async function popularIndex(load: Loader, limit = 20): Promise<PlaceHit[]> {
  const list = (await load("popular.json")) as PlaceRecord[] | null;
  return (list ?? []).slice(0, limit).map((rec) => toHit(rec, 0));
}

/** Nearest places to a point, from the 3×3 block of geo cells around it. */
export async function reverseIndex(
  load: Loader,
  lat: number,
  lon: number,
  limit = 5,
): Promise<PlaceHit[]> {
  const manifest = await loadManifest(load);
  if (!manifest) return [];
  const present = new Set(manifest.cells);
  const [ci, cj] = cellKey(lat, lon).split("_").map(Number);
  const wanted: string[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const key = `${ci + di}_${cj + dj}`;
      if (present.has(key)) wanted.push(key);
    }
  }
  const cells = await Promise.all(wanted.map((k) => load(`g/${k}.json`)));
  const kx = Math.cos((lat * Math.PI) / 180);
  const scored: Array<{ rec: PlaceRecord; d2: number }> = [];
  for (const cell of cells) {
    for (const rec of (cell as PlaceRecord[] | null) ?? []) {
      const dy = rec[6] - lat;
      const dx = (rec[7] - lon) * kx;
      const d2 = dy * dy + dx * dx;
      if (d2 <= MAX_REVERSE_DEG * MAX_REVERSE_DEG) scored.push({ rec, d2 });
    }
  }
  scored.sort((a, b) => a.d2 - b.d2);
  // Prefer the nearest AREAS; fall back to landmarks only where none are close.
  const areas = scored.filter(({ rec }) => AREA_KINDS.has(rec[2]));
  return (areas.length > 0 ? areas : scored).slice(0, limit).map(({ rec }) => toHit(rec, 0));
}

export { CELL_DEG };
