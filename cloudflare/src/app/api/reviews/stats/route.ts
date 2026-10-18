import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";

/** `GET /api/reviews/stats` — aggregate over approved reviews (Rust `ReviewStats`). */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brand_id");
    const routeId = url.searchParams.get("route_id");
    const scope = sql.raw(
      brandId
        ? ` AND brand_id = '${brandId.replace(/'/g, "''")}'`
        : routeId
          ? ` AND route_id = '${routeId.replace(/'/g, "''")}'`
          : "",
    );
    const agg = (
      await rawAll<{ avg: number | null; n: number; by_rating: string }>(sql`
        SELECT AVG(rating) AS avg, COUNT(*) AS n,
               (SELECT group_concat(x) FROM (SELECT rating AS x FROM review WHERE status = 'approved'${scope} ORDER BY created_at DESC LIMIT 500)) AS by_rating
        FROM review WHERE status = 'approved'${scope}
      `)
    )[0];
    const ratings = (agg?.by_rating ?? "").split(",").filter(Boolean).map(Number);
    const byRating = [1, 2, 3, 4, 5].map((star) => ratings.filter((r) => r === star).length);
    const tags = await rawAll<{ tag: string; n: number }>(sql`
      SELECT LOWER(TRIM(je.value)) AS tag, COUNT(*) AS n
      FROM review r, json_each(COALESCE(r.tags, '[]')) je
      WHERE r.status = 'approved'${scope}
      GROUP BY tag ORDER BY n DESC LIMIT 5
    `);
    return Response.json({
      count: Number(agg?.n ?? 0),
      average: agg?.avg != null ? Math.round(Number(agg.avg) * 10) / 10 : null,
      byRating,
      topTags: tags.map((t) => ({ tag: t.tag, count: Number(t.n) })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
