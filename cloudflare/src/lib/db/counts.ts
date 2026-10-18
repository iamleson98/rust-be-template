/**
 * Batched grouped counts — the port of the Rust stores' `count_*_map`
 * family (`count_routes_by_brand_map`, `count_pickup_points_by_route_map`,
 * …): `SELECT <key>, COUNT(*) WHERE <key> IN (…) GROUP BY <key>`.
 *
 * Why not a correlated subquery per row? Drizzle renders interpolated
 * columns UNQUALIFIED inside select-field `sql` fragments when the outer
 * query has no joins (`= "id"`), and SQLite then resolves that name
 * against the SUBQUERY's tables — silently wrong counts (observed:
 * every brand listed "0 routes" while routes existed). The two-query
 * pattern the Rust original uses has no such ambiguity and is fully
 * typed.
 *
 * Why chunked? D1 hard-caps bound parameters at 100 per query (local
 * miniflare does NOT enforce it — large IN lists pass tests and fail
 * in production). The Rust fan-out chunked for the same reason; 90 ids
 * + the extra filter's parameters stay under the cap.
 */
import { and, count, inArray, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getDb } from "@/lib/db/client";

/** 90 ids + a few filter parameters < D1's 100 bound-parameter cap. */
const IDS_PER_QUERY = 90;

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Counts grouped by `keyColumn`, restricted to `ids` (plus an optional
 * extra filter). The returned map is COMPLETE: every requested id is
 * present, ids with no rows count 0 — the Rust maps' `.unwrap_or(&0)`
 * semantics, without fallback operators.
 */
export async function groupedCounts(
  table: SQLiteTable,
  keyColumn: AnySQLiteColumn,
  ids: Array<string>,
  extraFilter?: SQL,
): Promise<Map<string, number>> {
  const complete = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return complete;
  const db = await getDb();
  for (const part of chunk(ids, IDS_PER_QUERY)) {
    const filter = extraFilter
      ? and(inArray(keyColumn, part), extraFilter)
      : inArray(keyColumn, part);
    const rows = await db
      .select({ key: keyColumn, n: count() })
      .from(table)
      .where(filter)
      .groupBy(keyColumn);
    for (const row of rows) {
      const key = row.key;
      // Text keys come back as strings; only those can match the ids.
      if (typeof key === "string") complete.set(key, Number(row.n));
    }
  }
  return complete;
}

/** `map.get(id)` with the "absent means zero" count semantic, explicitly. */
export function countOf(map: Map<string, number>, id: string | null): number {
  if (id === null) return 0;
  const n = map.get(id);
  if (n === undefined) return 0;
  return n;
}
