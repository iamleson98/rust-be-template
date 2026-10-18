import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { findCity } from "@/lib/services/trip-search";
import { listRoutesDefault } from "@/lib/services/lookups";
import { withRetry } from "@/lib/db/retry";

/**
 * `GET /api/routes` — list routes with their brand preview, city endpoints,
 * schedule count and lowest adult base price (Rust `RouteOut` contract).
 * Query: `brandId` (optional), `q`, `limit` (default 50), `offset`.
 *
 * The default (unfiltered) listing is cache-first; brandId/q-filtered
 * queries are per-request cardinality, so they always read D1 (retried on
 * transient errors) — see `services/lookups.ts`.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const brandId = url.searchParams.get("brandId");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 500);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const q = (url.searchParams.get("q") ?? "").trim();

    if (!brandId && !q) {
      // Hot path: cached default listing; city decoration is pure computation.
      const items = await listRoutesDefault(limit, offset);
      return Response.json({ items: items.map(decorateRoute) });
    }

    const rows = await withRetry(() =>
      rawAll<{
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
      `),
    );

    return Response.json({
      items: rows.map((r) =>
        decorateRoute({
          id: r.id,
          name: r.name,
          brandId: r.brand_id,
          brandSlug: r.brand_slug,
          brandName: r.brand_name,
          brandLogoUrl: r.brand_logo_url,
          brandRating: r.brand_rating,
          startLocationId: r.start_location_id,
          endLocationId: r.end_location_id,
          scheduleCount: Number(r.schedule_count),
          priceFrom: r.price_from == null ? null : Number(r.price_from),
        }),
      ),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `RouteOut` shape shared by both paths. */
function decorateRoute(r: {
  id: string;
  name: string;
  brandId?: string | null;
  brand_id?: string | null;
  brandSlug?: string | null;
  brandName?: string | null;
  brandLogoUrl?: string | null;
  brandRating?: number | null;
  startLocationId: string;
  endLocationId: string;
  scheduleCount: number;
  priceFrom: number | null;
}) {
  const from = findCity(r.startLocationId);
  const to = findCity(r.endLocationId);
  const brandId = r.brandId ?? r.brand_id ?? null;
  const brandName = r.brandName ?? null;
  const brandSlug = r.brandSlug ?? null;
  return {
    id: r.id,
    name: r.name,
    brandId,
    brand: brandId
      ? {
          name: brandName,
          slug: brandSlug,
          logoUrl: r.brandLogoUrl ?? null,
          rating: r.brandRating ?? null,
        }
      : null,
    from: {
      name: from?.name ?? r.startLocationId,
      lat: from?.lat ?? 0,
      lon: from?.lon ?? 0,
    },
    to: {
      name: to?.name ?? r.endLocationId,
      lat: to?.lat ?? 0,
      lon: to?.lon ?? 0,
    },
    priceFrom: r.priceFrom,
    scheduleCount: r.scheduleCount,
  };
}
