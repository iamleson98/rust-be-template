import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";

/**
 * `GET /api/brands` — active brands (slim `BrandOut`: id, slug, name,
 * logoUrl, rating, routeCount). Rust default limit 20, clamp 1..500.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      500,
    );
    const rows = await rawAll<{
      id: string;
      slug: string;
      name: string;
      logo_url: string | null;
      rating: number | null;
      route_count: number;
    }>(sql`
      SELECT b.id, b.slug, b.name, b.logo_url, b.rating,
             (SELECT COUNT(*) FROM route r WHERE r.brand_id = b.id AND r.status = 'active') AS route_count
      FROM brand b
      WHERE b.status = 'active'
      ORDER BY b.rating DESC, b.total_trips DESC, b.name ASC
      LIMIT ${limit}
    `);
    return Response.json({
      items: rows.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        logoUrl: b.logo_url,
        rating: b.rating,
        routeCount: b.route_count,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
