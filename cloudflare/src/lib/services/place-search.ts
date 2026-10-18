/**
 * Place search — D1 FTS5 port of the Tantivy PlaceSearcher.
 *
 * Ranking: bm25 over (name, name_no_tones, province, district, ward) with the
 * unicode61 remove_diacritics tokenizer covering Vietnamese tone-insensitivity,
 * plus kind boosts mirroring the Rust re-ranker
 * (city 4 > province 3 > district 2 > ward 1.5 > village 1.2 > ...).
 * Input is sanitized into quoted AND-terms to avoid FTS5 syntax errors.
 */
import { getD1 } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { compactNoTones, stripTones } from "@/lib/format";

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

const KIND_BOOST: Record<string, number> = {
  city: 4,
  province: 3,
  district: 2,
  ward: 1.5,
  village: 1.2,
  suburb: 1.1,
  street: 1.0,
  hamlet: 1.0,
  island: 1.0,
  poi: 0.7,
};

/** Expand Vietnamese admin abbreviations (P. → Phường, Q. → Quận, ...). */
function expandAbbreviations(q: string): string {
  return q
    .replace(/\bP\.\s*/gi, "Phường ")
    .replace(/\bQ\.\s*/gi, "Quận ")
    .replace(/\bTP\.\s*/gi, "Thành phố ")
    .replace(/\bTX\.\s*/gi, "Thị xã ")
    .replace(/\bTT\.\s*/gi, "Thị trấn ")
    .replace(/\bX\.\s*/gi, "Xã ")
    .replace(/\bĐ\.\s*/gi, "Đường ")
    .replace(/\bD\.\s*/gi, "Đường ")
    .replace(/\bSt\.\s*/gi, "Đường ");
}

/** Sanitize to an FTS5 AND-of-phrases query over the normalized text. */
export function buildMatchQuery(raw: string): string | null {
  const normalized = stripTones(expandAbbreviations(raw));
  const tokens = normalized
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)
    .slice(0, 6);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" AND ");
}

export async function searchPlaces(raw: string, limit = 10): Promise<PlaceHit[]> {
  const q = buildMatchQuery(raw);
  if (!q) return [];
  const d1 = await getD1();
  const { results } = await withRetry(() =>
    d1
      .prepare(
        `
      SELECT p.id, p.name, p.name_no_tones, p.type, p.province, p.district, p.ward, p.lat, p.lon,
             bm25(place_fts) AS rank
      FROM place_fts
      JOIN place p ON p.rowid = place_fts.rowid
      WHERE place_fts MATCH ?
      ORDER BY rank
      LIMIT ?
      `,
      )
      .bind(q, Math.min(limit * 3, 50))
      .all<{
        id: string;
        name: string;
        name_no_tones: string | null;
        type: string;
        province: string | null;
        district: string | null;
        ward: string | null;
        lat: number;
        lon: number;
        rank: number;
      }>(),
  );
  if (!results) return [];

  // Compact-form exact boost ("hanoi" matches name_no_tones without spaces).
  const compact = compactNoTones(raw);
  const hits: PlaceHit[] = results.map((r) => {
    const kindBoost = KIND_BOOST[r.type] ?? 1;
    const compactBoost = compact && compactNoTones(r.name ?? "") === compact ? 5 : 0;
    return {
      id: r.id,
      name: r.name,
      nameNoTones: r.name_no_tones,
      type: r.type,
      province: r.province,
      district: r.district,
      ward: r.ward,
      lat: Number(r.lat),
      lon: Number(r.lon),
      score: kindBoost + compactBoost - Math.abs(Number(r.rank) ?? 0),
    };
  });
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Popular places for the default autocomplete list. */
export async function popularPlaces(limit = 20): Promise<PlaceHit[]> {
  const d1 = await getD1();
  const { results } = await d1
    .prepare(
      `SELECT id, name, name_no_tones, type, province, district, ward, lat, lon, 0 AS rank
       FROM place ORDER BY population DESC, name LIMIT ?`,
    )
    .bind(limit)
    .all<{
      id: string;
      name: string;
      name_no_tones: string | null;
      type: string;
      province: string | null;
      district: string | null;
      ward: string | null;
      lat: number;
      lon: number;
    }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    nameNoTones: r.name_no_tones,
    type: r.type,
    province: r.province,
    district: r.district,
    ward: r.ward,
    lat: Number(r.lat),
    lon: Number(r.lon),
    score: 0,
  }));
}

/** Reverse geocode: nearest place within ~50km box, haversine-sorted. */
export async function reverseGeocode(lat: number, lon: number, limit = 5): Promise<PlaceHit[]> {
  const d1 = await getD1();
  const { results } = await d1
    .prepare(
      `SELECT id, name, name_no_tones, type, province, district, ward, lat, lon, 0 AS rank
       FROM place
       WHERE lat BETWEEN ? - 0.45 AND ? + 0.45
         AND lon BETWEEN ? - 0.45 AND ? + 0.45
       ORDER BY (lat - ?) * (lat - ?) + (lon - ?) * (lon - ?)
       LIMIT ?`,
    )
    .bind(lat, lat, lon, lon, lat, lat, lon, lon, limit)
    .all<{
      id: string;
      name: string;
      name_no_tones: string | null;
      type: string;
      province: string | null;
      district: string | null;
      ward: string | null;
      lat: number;
      lon: number;
    }>();
  return (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    nameNoTones: r.name_no_tones,
    type: r.type,
    province: r.province,
    district: r.district,
    ward: r.ward,
    lat: Number(r.lat),
    lon: Number(r.lon),
    score: 0,
  }));
}

/** Rebuild the FTS index from the place table (cron: fts.reindex). */
export async function reindexPlaces(): Promise<{ indexed: number }> {
  const d1 = await getD1();
  await d1.exec(`INSERT INTO place_fts(place_fts) VALUES('rebuild');`);
  const { results } = await d1.prepare(`SELECT COUNT(*) AS n FROM place`).all<{ n: number }>();
  return { indexed: Number(results?.[0]?.n ?? 0) };
}
