import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { findCity } from "@/lib/services/trip-search";

/**
 * `GET /api/routes` — list routes with their brand preview, city endpoints,
 * schedule count and lowest adult base price (Rust `RouteOut` contract).
 * Query: `brandId` (optional), `q`, `limit` (default 50), `offset`.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brandId");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 500);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const q = (url.searchParams.get("q") ?? "").trim();

    const rows = await rawAll<{
      id: string;
      name: string;
      status: string;
      brand_id: string | null;
      brand_slug: string | null;
      brand_name: string | null;
      brand_logo_url: string | null;
      brand_rating: number | null;
      start_location_id: string;
      end_location_id: string;
      schedule_count: number;
      price_from: number | null;
    }>(sql`
      SELECT r.id, r.name, r.status,
             r.brand_id, b.slug AS brand_slug, b.name AS brand_name,
             b.logo_url AS brand_logo_url, b.rating AS brand_rating,
             r.start_location_id, r.end_location_id,
             (SELECT COUNT(*) FROM schedule s WHERE s.route_id = r.id) AS schedule_count,
             (SELECT MIN(s.base_price_adult) FROM schedule s WHERE s.route_id = r.id) AS price_from
      FROM route r
      LEFT JOIN brand b ON b.id = r.brand_id
      WHERE ${brandId ? sql`r.brand_id = ${brandId}` : sql`r.status = 'active'`}
        ${q ? sql`AND r.name LIKE ${"%" + q + "%"}` : sql``}
      ORDER BY r.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return Response.json({
      items: rows.map((r) => {
        const from = findCity(r.start_location_id);
        const to = findCity(r.end_location_id);
        return {
          id: r.id,
          name: r.name,
          brandId: r.brand_id,
          brand: r.brand_id
            ? {
                name: r.brand_name,
                slug: r.brand_slug,
                logoUrl: r.brand_logo_url,
                rating: r.brand_rating,
              }
            : null,
          from: {
            name: from?.name ?? r.start_location_id,
            lat: from?.lat ?? 0,
            lon: from?.lon ?? 0,
          },
          to: {
            name: to?.name ?? r.end_location_id,
            lat: to?.lat ?? 0,
            lon: to?.lon ?? 0,
          },
          priceFrom: r.price_from,
          scheduleCount: r.schedule_count,
        };
      }),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
