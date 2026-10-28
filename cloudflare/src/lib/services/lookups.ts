/**
 * Cached store lookups — the port of the Rust app's cache-first reads
 * (moka → two-tier Workers cache, see `db/cache.ts`).
 *
 * Every lookup: retry the D1 read on transient errors (`db/retry.ts`),
 * serve from L1 memory → L2 KV → database, and refresh the tiers on the
 * way back. Admin write routes call the matching `invalidate*` helper so
 * changes surface on the next request instead of waiting out the TTL.
 *
 * What is cached — and deliberately NOT cached:
 *   cached: reference data (brands, routes list, vehicle types, popular
 *           places, review tags, homepage counters)
 *   NEVER:  seat maps, availability, booking/payment/auth state — those
 *           are correctness-critical and always read D1 directly.
 */
import { getDb, rawAll } from "@/lib/db/client";
import { asc, desc, eq, sql } from "drizzle-orm";
import { brands, routes, vehicleTypes } from "@/lib/db/schema";
import { countOf, groupedCounts } from "@/lib/db/counts";
import { cacheFirst, cacheInvalidatePrefix } from "@/lib/db/cache";
import { withRetry } from "@/lib/db/retry";

// ── Brands ─────────────────────────────────────────────────────

export interface BrandListItem {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  rating: number | null;
  routeCount: number;
}

/** `GET /api/brands` — active brands, rating-ordered.
 * (Two queries on purpose — the Rust `list_active` + `count_routes_by_brand_map`
 * pair; a correlated per-row count subquery is exactly the footgun that
 * silently returned 0 for every brand, see db/counts.ts.) */
export async function listBrands(limit: number): Promise<BrandListItem[]> {
  return cacheFirst(
    `lookups:brands:${limit}`,
    () =>
      withRetry(async () => {
        const db = await getDb();
        const rows = await db
          .select({
            id: brands.id,
            slug: brands.slug,
            name: brands.name,
            logoUrl: brands.logoUrl,
            rating: brands.rating,
          })
          .from(brands)
          .where(eq(brands.status, "active"))
          .orderBy(desc(brands.rating), desc(brands.totalTrips), asc(brands.name))
          .limit(limit);
        const routeCounts = await groupedCounts(
          routes,
          routes.brandId,
          rows.map((b) => b.id),
          eq(routes.status, "active"),
        );
        return rows.map((b) => ({ ...b, routeCount: countOf(routeCounts, b.id) }));
      }),
    { ttlMs: 60_000 },
  );
}

/** `GET /api/brands/{slug}` — brand detail. */
export async function getBrandBySlug(slug: string): Promise<{
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  description: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  rating: number | null;
} | null> {
  return cacheFirst(
    `lookups:brand:${slug}`,
    () =>
      withRetry(async () => {
        const db = await getDb();
        const row = (await db.select().from(brands).where(eq(brands.slug, slug)).limit(1))[0];
        if (!row) return null;
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          logoUrl: row.logoUrl,
          description: row.description,
          contactPhone: row.contactPhone,
          contactEmail: row.contactEmail,
          rating: row.rating,
        };
      }),
    { ttlMs: 60_000 },
  );
}

// ── Routes (default listing only — filtered/searched pages always hit D1) ──

export interface RouteListItem {
  id: string;
  name: string;
  status: string;
  brandId: string | null;
  brandSlug: string | null;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandRating: number | null;
  startLocationId: string;
  endLocationId: string;
  scheduleCount: number;
  priceFrom: number | null;
}

/** `GET /api/routes` default page (no brandId / no q filters). */
export async function listRoutesDefault(limit: number, offset: number): Promise<RouteListItem[]> {
  return cacheFirst(
    `lookups:routes:${limit}:${offset}`,
    () =>
      withRetry(async () => {
        const db = await getDb();
        const rows = await db
          .select({
            id: routes.id,
            name: routes.name,
            status: routes.status,
            brandId: routes.brandId,
            brandSlug: brands.slug,
            brandName: brands.name,
            brandLogoUrl: brands.logoUrl,
            brandRating: brands.rating,
            startLocationId: routes.startLocationId,
            endLocationId: routes.endLocationId,
            scheduleCount: sql<number>`(SELECT COUNT(*) FROM schedule s WHERE s.route_id = ${routes.id})`,
            priceFrom: sql<
              number | null
            >`(SELECT MIN(s.base_price_adult) FROM schedule s WHERE s.route_id = ${routes.id})`,
          })
          .from(routes)
          .leftJoin(brands, eq(brands.id, routes.brandId))
          .where(eq(routes.status, "active"))
          .orderBy(desc(routes.createdAt))
          .limit(limit)
          .offset(offset);
        return rows.map((r) => ({
          ...r,
          scheduleCount: Number(r.scheduleCount),
          priceFrom: r.priceFrom == null ? null : Number(r.priceFrom),
        }));
      }),
    { ttlMs: 30_000 },
  );
}

// ── Vehicle types (label catalog used by search + trip detail) ──

export interface VehicleTypeEntry {
  code: string;
  label: string;
}

export async function vehicleTypeCatalog(): Promise<VehicleTypeEntry[]> {
  return cacheFirst(
    "lookups:vehicle-types",
    () =>
      withRetry(async () => {
        const db = await getDb();
        return db
          .select({ code: vehicleTypes.code, label: vehicleTypes.label })
          .from(vehicleTypes)
          .orderBy(asc(vehicleTypes.sortOrder));
      }),
    { ttlMs: 300_000 },
  );
}

// ── Homepage counters ───────────────────────────────────────────

export type HomeStats = Record<string, number>;

/** `GET /api/stats` — public landing-page counters.
 * (Seven scalar-subquery counters in ONE round trip — deliberately a
 * single statement; seven separate builder queries would be slower.) */
export async function homeStats(): Promise<HomeStats> {
  return cacheFirst(
    "lookups:stats",
    () =>
      withRetry(async () => {
        const rows = await rawAll<{
          brands: number;
          routes: number;
          trips: number;
          bookings: number;
          confirmed: number;
          reviews: number;
          users: number;
        }>(sql`
          SELECT
            (SELECT COUNT(*) FROM brand WHERE status = 'active') AS brands,
            (SELECT COUNT(*) FROM route WHERE status = 'active') AS routes,
            (SELECT COUNT(*) FROM trip_session WHERE departure_date >= date('now')) AS trips,
            (SELECT COUNT(*) FROM booking) AS bookings,
            (SELECT COUNT(*) FROM booking WHERE status = 'confirmed') AS confirmed,
            (SELECT COUNT(*) FROM review WHERE status = 'approved') AS reviews,
            (SELECT COUNT(*) FROM "user") AS users
        `);
        const agg = rows[0] ?? {
          brands: 0,
          routes: 0,
          trips: 0,
          bookings: 0,
          confirmed: 0,
          reviews: 0,
          users: 0,
        };
        const stats: HomeStats = {};
        for (const [k, v] of Object.entries(agg)) stats[k] = Number(v);
        return stats;
      }),
    { ttlMs: 30_000 },
  );
}

// ── Invalidation hooks (call from admin write routes) ───────────

/** Brand writes (and brand-affecting route writes) — brands + stats. */
export const invalidateBrands = () =>
  cacheInvalidatePrefix("lookups:brands:", "lookups:brand:", "lookups:stats");

/** Route / schedule writes — routes list + stats. */
export const invalidateRoutes = () => cacheInvalidatePrefix("lookups:routes:", "lookups:stats");

/** Vehicle-type catalog writes. */
export const invalidateVehicleTypes = () => cacheInvalidatePrefix("lookups:vehicle-types");

/** Place / FTS writes. */

/** Review moderation — tags + stats. */
export const invalidateReviews = () =>
  cacheInvalidatePrefix("lookups:review-tags:", "lookups:stats");

/** User / booking counters (stats). */
export const invalidateStats = () => cacheInvalidatePrefix("lookups:stats");
