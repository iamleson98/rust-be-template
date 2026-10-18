import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Get the Drizzle client bound to the request's D1 binding.
 * Works in `next dev` (miniflare via initOpenNextCloudflareForDev)
 * and in production (OpenNext worker).
 */
export async function getDb(): Promise<Database> {
  const { env } = await getCloudflareContext({ async: true });
  return drizzle(env.DB as D1Database, { schema });
}

/** Raw D1 binding for FTS5 queries + batch statements. */
export async function getD1(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  return env.DB as D1Database;
}

/** R2 bucket binding for media storage. */
export async function getR2(): Promise<R2Bucket> {
  const { env } = await getCloudflareContext({ async: true });
  return env.UPLOADS as R2Bucket;
}

/** Typed accessor for CloudflareEnv vars/secrets. */
export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env as CloudflareEnv;
}

/** Raw SQL SELECT → typed rows (drizzle's all() loses generics for raw SQL). */
export async function rawAll<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const db = await getDb();
  const rows = (await db.all(query)) as unknown;
  return (Array.isArray(rows) ? rows : ((rows as { results?: T[] }).results ?? [])) as T[];
}

/** Raw SQL statement → D1Result (meta.changes for writes). */
export async function rawRun(query: SQL): Promise<D1Result<Record<string, unknown>>> {
  const db = await getDb();
  return (await db.run(query)) as D1Result<Record<string, unknown>>;
}

/**
 * Atomic batch of RAW SQL statements via the native D1 batch API.
 * (drizzle's db.batch only accepts query builders; raw db.run items lack
 * the prepared .stmt the D1 session expects.)
 */
export async function rawBatch(queries: SQL[]): Promise<D1Result<Record<string, unknown>>[]> {
  const db = await getDb();
  const d1 = await getD1();
  const dialect = (db as unknown as { dialect: { sqlToQuery: (q: SQL) => { sql: string; params: unknown[] } } }).dialect;
  const stmts = queries.map((q) => {
    const built = dialect.sqlToQuery(q);
    const stmt = d1.prepare(built.sql);
    return built.params.length > 0 ? stmt.bind(...built.params) : stmt;
  });
  return d1.batch(stmts) as Promise<D1Result<Record<string, unknown>>[]>;
}

/** Build a raw INSERT statement from a plain row object. */
export function insertSql(table: string, row: Record<string, unknown>): SQL {
  const cols = Object.keys(row);
  const colList = sql.raw(cols.map((c) => `"${c}"`).join(", "));
  const values = cols.map((c) => sql`${row[c]}`).reduce((a, b) => sql`${a}, ${b}`);
  return sql`INSERT INTO ${sql.raw(`"${table}"`)} (${colList}) VALUES (${values})`;
}
