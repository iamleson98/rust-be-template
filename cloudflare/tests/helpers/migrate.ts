/**
 * Migration helper — applies the REAL wrangler migration chain to the test
 * D1 exactly the way `wrangler d1 migrations apply` does: split each file
 * on its `--> statement-breakpoint` markers, then run all statements of a
 * file in one batch (CREATE TRIGGER bodies contain semicolons but never
 * the marker, so the split is safe).
 */
import { env } from "cloudflare:test";

export async function applyMigrations(...files: string[]): Promise<void> {
  for (const sql of files) {
    const queries = sql
      .split("--> statement-breakpoint")
      .map(stripComments)
      .filter((q) => q.length > 0);
    if (queries.length === 0) continue;
    await env.DB.batch(queries.map((q) => env.DB.prepare(q)));
  }
}

/** Drop `--` line comments (migrations use no multiline string literals). */
function stripComments(chunk: string): string {
  return chunk
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/;\s*$/, "")
    .trim();
}
