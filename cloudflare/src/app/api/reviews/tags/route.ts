import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";

/** `GET /api/reviews/tags` — the tags that appear on approved reviews. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "12", 10) || 12, 50);
    const rows = await rawAll<{ tag: string }>(sql`
      SELECT DISTINCT LOWER(TRIM(je.value)) AS tag
      FROM review r, json_each(COALESCE(r.tags, '[]')) je
      WHERE r.status = 'approved' AND TRIM(je.value) != ''
      ORDER BY tag LIMIT ${limit}
    `);
    return Response.json({ items: rows.map((r) => r.tag) });
  } catch (e) {
    return handleRouteError(e);
  }
}
