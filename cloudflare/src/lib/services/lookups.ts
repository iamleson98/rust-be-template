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
 *           places, campaigns, review tags, homepage counters)
 *   NEVER:  seat maps, availability, booking/payment/auth state — those
 *           are correctness-critical and always read D1 directly.
 */
import { getDb, rawAll } from "@/lib/db/client";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  brands,
  discountCampaignBrands,
  discountCampaigns,
  discountTiers,
  routes,
  vehicleTypes,
} from "@/lib/db/schema";
import { cacheFirst, cacheInvalidatePrefix } from "@/lib/db/cache";
import { withRetry } from "@/lib/db/retry";
import { popularPlaces, type PlaceHit } from "./place-search";

// ── Brands ─────────────────────────────────────────────────────

export interface BrandListItem {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  rating: number | null;
  routeCount: number;
}

/** `GET /api/brands` — active brands, rating-ordered. */
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
            routeCount: sql<number>`(
              SELECT COUNT(*) FROM route r WHERE r.brand_id = ${brands.id} AND r.status = 'active'
            )`,
          })
          .from(brands)
          .where(eq(brands.status, "active"))
          .orderBy(desc(brands.rating), desc(brands.totalTrips), asc(brands.name))
          .limit(limit);
        return rows.map((b) => ({ ...b, routeCount: Number(b.routeCount) }));
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

// ── Places (autocomplete default list) ──────────────────────────

export async function popularPlacesCached(limit: number): Promise<PlaceHit[]> {
  return cacheFirst(`lookups:places:${limit}`, () => withRetry(() => popularPlaces(limit)), {
    ttlMs: 600_000,
  });
}

// ── Campaigns ───────────────────────────────────────────────────

export interface PublicCampaign {
  id: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  couponValidity: string;
  allBrands: boolean;
  brands: Array<{ id: string; name: string; slug: string; logoUrl: string | null }>;
  tiers: Array<{ id: string; amount: number; remaining: number; totalSlots: number }>;
}

/** `GET /api/campaigns` item computation (serverTime is added per response). */
export async function listPublicCampaigns(): Promise<PublicCampaign[]> {
  return cacheFirst(
    "lookups:campaigns",
    () =>
      withRetry(async () => {
        const db = await getDb();
        const now = new Date().toISOString();
        const rows = await db
          .select({
            id: discountCampaigns.id,
            name: discountCampaigns.name,
            description: discountCampaigns.description,
            startsAt: discountCampaigns.startsAt,
            endsAt: discountCampaigns.endsAt,
            couponValidity: discountCampaigns.couponValidity,
            allBrands: discountCampaigns.allBrands,
          })
          .from(discountCampaigns)
          .where(
            and(
              eq(discountCampaigns.paused, false),
              lte(discountCampaigns.startsAt, now),
              gte(discountCampaigns.endsAt, now),
            ),
          )
          .orderBy(desc(discountCampaigns.startsAt));
        if (!rows.length) return [];

        const brandRows = await db
          .select({
            campaignId: discountCampaignBrands.campaignId,
            id: brands.id,
            name: brands.name,
            slug: brands.slug,
            logoUrl: brands.logoUrl,
          })
          .from(discountCampaignBrands)
          .innerJoin(brands, eq(brands.id, discountCampaignBrands.brandId));
        const tierRows = await db
          .select({
            campaignId: discountTiers.campaignId,
            id: discountTiers.id,
            amount: discountTiers.amount,
            totalSlots: discountTiers.totalSlots,
            claimedSlots: discountTiers.claimedSlots,
          })
          .from(discountTiers)
          .orderBy(asc(discountTiers.position), asc(discountTiers.amount));

        const brandsBy = new Map<string, PublicCampaign["brands"]>();
        for (const b of brandRows) {
          const list = brandsBy.get(b.campaignId) ?? [];
          list.push({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logoUrl });
          brandsBy.set(b.campaignId, list);
        }
        const tiersBy = new Map<string, PublicCampaign["tiers"]>();
        for (const t of tierRows) {
          const list = tiersBy.get(t.campaignId) ?? [];
          list.push({
            id: t.id,
            amount: Number(t.amount),
            remaining: Math.max(0, Number(t.totalSlots) - Number(t.claimedSlots)),
            totalSlots: Number(t.totalSlots),
          });
          tiersBy.set(t.campaignId, list);
        }

        return rows.map((c) => ({
          ...c,
          brands: brandsBy.get(c.id) ?? [],
          tiers: tiersBy.get(c.id) ?? [],
        }));
      }),
    { ttlMs: 30_000 },
  );
}

// ── Review tags ─────────────────────────────────────────────────

/** `GET /api/reviews/tags` — tags that appear on approved reviews.
 * (json_each lateral + DISTINCT LOWER — SQL semantics drizzle has no
 * builder for; kept as a parameterized template on purpose.) */
export async function reviewTags(limit: number): Promise<string[]> {
  return cacheFirst(
    `lookups:review-tags:${limit}`,
    () =>
      withRetry(async () => {
        const rows = await rawAll<{ tag: string }>(sql`
          SELECT DISTINCT LOWER(TRIM(je.value)) AS tag
          FROM review r, json_each(COALESCE(r.tags, '[]')) je
          WHERE r.status = 'approved' AND TRIM(je.value) != ''
          ORDER BY tag LIMIT ${limit}
        `);
        return rows.map((r) => r.tag);
      }),
    { ttlMs: 120_000 },
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
            (SELECT COUNT(*) FROM review WHERE status = 'published') AS reviews,
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
export const invalidatePlaces = () => cacheInvalidatePrefix("lookups:places:");

/** Campaign / tier / coupon-claim writes (claims change remaining slots). */
export const invalidateCampaigns = () => cacheInvalidatePrefix("lookups:campaigns");

/** Review moderation — tags + stats. */
export const invalidateReviews = () =>
  cacheInvalidatePrefix("lookups:review-tags:", "lookups:stats");

/** User / booking counters (stats). */
export const invalidateStats = () => cacheInvalidatePrefix("lookups:stats");
