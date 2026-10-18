import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
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

// ── Raw SQL helpers ────────────────────────────────────────────
//
// SQL POLICY for this codebase:
//   1. Standard CRUD → the drizzle query builder (`db.select/insert/
//      update/delete` with typed schema tables). Types + parameters for free.
//   2. FTS5 MATCH, recursive CTEs, conditional atomic UPDATEs and analytics
//      → `sql` tagged templates. Every interpolated value becomes a bound
//      parameter — NEVER string-concatenated — so both styles are
//      injection-safe; the builder is just the more ergonomic default.
//   3. Multi-statement atomic units → `atomicBatch` below, which accepts
//      BOTH builders and raw `sql` templates in a single D1 transaction.

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

/** A drizzle query builder (select/insert/update/delete) usable in atomicBatch. */
export type BatchBuilder = BatchItem<"sqlite">;

/** Duck-typed access to the internal builder API drizzle's own batch uses. */
interface Preparable {
  _prepare(): { getQuery(): { sql: string; params: unknown[] } };
}

/** Anything `atomicBatch` accepts: raw `sql` templates + drizzle builders. */
export type AtomicStatement = SQL | BatchBuilder;

/**
 * Atomic batch of statements via the native D1 batch API — a single implicit
 * transaction. Unlike drizzle's `db.batch`, this accepts raw `sql` templates
 * AND typed query builders side by side, so a unit can mix ergonomic
 * `db.insert(...).values(...)` builders with conditional raw UPDATEs
 * (the seat-claim pattern) while staying atomic.
 */
export async function atomicBatch<T = Record<string, unknown>>(queries: AtomicStatement[]): Promise<D1Result<T>[]> {
  const db = await getDb();
  const d1 = await getD1();
  const dialect = (db as unknown as { dialect: { sqlToQuery: (q: SQL) => { sql: string; params: unknown[] } } }).dialect;
  const stmts = queries.map((q) => {
    const built =
      q instanceof SQL
        ? dialect.sqlToQuery(q)
        : (q as unknown as Preparable)._prepare().getQuery();
    const stmt = d1.prepare(built.sql);
    return built.params.length > 0 ? stmt.bind(...(built.params as unknown[])) : stmt;
  });
  return d1.batch(stmts) as Promise<D1Result<T>[]>;
}

/**
 * In-clause helper for raw SQL: `IN (${sqlIn(ids)})` with every value bound
 * as a parameter (injection-safe even for untrusted lists).
 */
export function sqlIn(values: Array<string | number>): SQL {
  if (values.length === 0) return sql`NULL`;
  return values.map((v) => sql`${v}`).reduce((a, b) => sql`${a}, ${b}`);
}
