import { getDb } from "@/lib/db/client";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { brands, routes, schedules } from "@/lib/db/schema";
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
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
      500,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const q = (url.searchParams.get("q") ?? "").trim();

    if (!brandId && !q) {
      // Hot path: cached default listing; city decoration is pure computation.
      const items = await listRoutesDefault(limit, offset);
      return Response.json({ items: items.map(decorateRoute) });
    }

    const db = await getDb();
    const rows = await withRetry(() =>
      db
        .select({
          route: routes,
          brandSlug: brands.slug,
          brandName: brands.name,
          brandLogoUrl: brands.logoUrl,
          brandRating: brands.rating,
          scheduleCount: sql<number>`(SELECT COUNT(*) FROM ${schedules} WHERE ${schedules.routeId} = ${routes.id})`,
          priceFrom: sql<
            number | null
          >`(SELECT MIN(${schedules.basePriceAdult}) FROM ${schedules} WHERE ${schedules.routeId} = ${routes.id})`,
        })
        .from(routes)
        .leftJoin(brands, eq(brands.id, routes.brandId))
        .where(
          and(
            // `?brandId=` (empty) behaves like absent: the active-route default.
            brandId !== null && brandId.length > 0
              ? eq(routes.brandId, brandId)
              : eq(routes.status, "active"),
            q.length > 0 ? like(routes.name, `%${q}%`) : undefined,
          ),
        )
        .orderBy(desc(routes.createdAt))
        .limit(limit)
        .offset(offset),
    );

    return Response.json({
      items: rows.map((r) =>
        decorateRoute({
          id: r.route.id,
          name: r.route.name,
          brandId: r.route.brandId,
          brandSlug: r.brandSlug,
          brandName: r.brandName,
          brandLogoUrl: r.brandLogoUrl,
          brandRating: r.brandRating,
          startLocationId: r.route.startLocationId,
          endLocationId: r.route.endLocationId,
          scheduleCount: Number(r.scheduleCount),
          priceFrom: r.priceFrom == null ? null : Number(r.priceFrom),
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
