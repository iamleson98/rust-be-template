/**
 * Public catalog reads — brands, routes and the homepage counters — plus the
 * cached review tags.
 *
 * The public lists are not cached here: `GET /api/brands`, `/api/routes`,
 * `/api/stats` and `/api/recommendations` are served from the Workers Cache
 * API in front of the app (`edge-guard.ts`, 60 s, bypassed for signed-in
 * callers), which costs no D1 read and no KV operation and needs no
 * invalidation from admin writes beyond that TTL — the staleness Rust
 * allowed its browsers (`Cache-Control: public, max-age=60`).
 *
 * NEVER cached: seat maps, availability, booking/payment/auth state.
 */
import { getDb, inList } from "@/lib/db/client";
import { and, asc, count, desc, eq, gte, min } from "drizzle-orm";
import { brands, routes, schedules, tripSessions } from "@/lib/db/schema";
import { countOf, groupedCounts } from "@/lib/db/counts";
import { cacheInvalidatePrefix } from "@/lib/db/cache";
import { withRetry } from "@/lib/db/retry";
import { findCity, nameForSlug } from "@/lib/city-match";
import { localToday } from "./trip-time";

// ── Brands ─────────────────────────────────────────────────────

export interface BrandListItem {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  rating: number | null;
  routeCount: number;
}

/**
 * `GET /api/brands` — active brands, best rated first, each with its number
 * of active routes. (Two queries on purpose — the Rust `list_active` +
 * `count_routes_by_brand_map` pair; a correlated per-row count subquery is
 * exactly the footgun that silently returned 0 for every brand, see
 * db/counts.ts.) `limit` is clamped to 1..500.
 */
export async function listBrands(limit: number): Promise<BrandListItem[]> {
  const db = await getDb();
  const rows = await withRetry(() =>
    db
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
      .limit(Math.min(Math.max(limit, 1), 500)),
  );
  const routeCounts = await groupedCounts(
    routes,
    routes.brandId,
    rows.map((b) => b.id),
    eq(routes.status, "active"),
  );
  return rows.map((b) => ({ ...b, routeCount: countOf(routeCounts, b.id) }));
}

/** `GET /api/brands/{slug}` — an active brand's detail; null when unknown or not active. */
export async function getBrandBySlug(slug: string) {
  const db = await getDb();
  const row = (
    await withRetry(() => db.select().from(brands).where(eq(brands.slug, slug)).limit(1))
  )[0];
  if (!row || row.status !== "active") return null;
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
}

// ── Routes ─────────────────────────────────────────────────────

/** A route's endpoints: its cities' names, or — when neither city is known — the name split at `→`. */
function endpointNames(r: { name: string; startLocationId: string; endLocationId: string }) {
  const from = nameForSlug(r.startLocationId);
  const to = nameForSlug(r.endLocationId);
  if (from !== r.startLocationId || to !== r.endLocationId) return { from, to };
  const arrow = r.name.indexOf(" → ");
  return arrow < 0
    ? { from: r.name, to: "" }
    : { from: r.name.slice(0, arrow), to: r.name.slice(arrow + " → ".length) };
}

/**
 * `GET /api/routes` — active routes by name (of one brand when `brandId` is
 * given), each with its brand preview, endpoints, schedule count and the
 * lowest adult base price (the real "from" price; never fabricated).
 * `limit` is clamped to 1..500 (Rust `PublicService::list_routes`).
 */
export async function listRoutes(brandId: string | undefined, limit: number) {
  const db = await getDb();
  const rows = await withRetry(() =>
    db
      .select()
      .from(routes)
      .where(and(eq(routes.status, "active"), brandId ? eq(routes.brandId, brandId) : undefined))
      .orderBy(asc(routes.name))
      .limit(Math.min(Math.max(limit, 1), 500)),
  );
  const brandIds = [...new Set(rows.flatMap((r) => (r.brandId ? [r.brandId] : [])))];
  const routeIds = rows.map((r) => r.id);
  const [brandRows, scheduleStats] = await Promise.all([
    db.select().from(brands).where(inList(brands.id, brandIds)),
    db
      .select({ routeId: schedules.routeId, n: count(), from: min(schedules.basePriceAdult) })
      .from(schedules)
      .where(inList(schedules.routeId, routeIds))
      .groupBy(schedules.routeId),
  ]);
  const brandById = new Map(brandRows.map((b) => [b.id, b]));
  const statsByRoute = new Map(scheduleStats.map((s) => [s.routeId, s]));
  return rows.map((r) => {
    const brand = r.brandId ? brandById.get(r.brandId) : undefined;
    const names = endpointNames(r);
    const from = findCity(r.startLocationId);
    const to = findCity(r.endLocationId);
    const stats = statsByRoute.get(r.id);
    return {
      id: r.id,
      brandId: r.brandId ?? undefined,
      name: r.name,
      brand: {
        name: brand?.name,
        slug: brand?.slug,
        logoUrl: brand?.logoUrl ?? undefined,
        rating: brand?.rating ?? undefined,
      },
      from: { name: names.from, lat: from?.lat ?? 0, lon: from?.lon ?? 0 },
      to: { name: names.to, lat: to?.lat ?? 0, lon: to?.lon ?? 0 },
      scheduleCount: stats ? Number(stats.n) : 0,
      priceFrom: stats?.from ?? undefined,
    };
  });
}

// ── Homepage counters ───────────────────────────────────────────

export interface HomeStats {
  /** Active brands. */
  brands: number;
  /** Active routes. */
  routes: number;
  /** Scheduled trips departing today (Vietnam) or later. */
  trips: number;
}

/** `GET /api/stats` — the public landing-page counters (Rust `PublicService::stats`). */
export async function homeStats(): Promise<HomeStats> {
  const db = await getDb();
  const [[brandCount], [routeCount], [tripCount]] = await withRetry(() =>
    Promise.all([
      db.select({ n: count() }).from(brands).where(eq(brands.status, "active")),
      db.select({ n: count() }).from(routes).where(eq(routes.status, "active")),
      db
        .select({ n: count() })
        .from(tripSessions)
        .where(
          and(eq(tripSessions.status, "scheduled"), gte(tripSessions.departureDate, localToday())),
        ),
    ]),
  );
  return {
    brands: Number(brandCount?.n ?? 0),
    routes: Number(routeCount?.n ?? 0),
    trips: Number(tripCount?.n ?? 0),
  };
}

// ── Invalidation hooks (call from admin write routes) ───────────

/** Review moderation — the cached review tags. */
export const invalidateReviews = () => cacheInvalidatePrefix("lookups:review-tags:");
