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
import { rawAll, getDb } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { brands } from "@/lib/db/schema";
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
        return rows.map((b) => ({
          id: b.id,
          slug: b.slug,
          name: b.name,
          logoUrl: b.logo_url,
          rating: b.rating,
          routeCount: Number(b.route_count),
        }));
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
          WHERE r.status = 'active'
          ORDER BY r.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          brandId: r.brand_id,
          brandSlug: r.brand_slug,
          brandName: r.brand_name,
          brandLogoUrl: r.brand_logo_url,
          brandRating: r.brand_rating,
          startLocationId: r.start_location_id,
          endLocationId: r.end_location_id,
          scheduleCount: Number(r.schedule_count),
          priceFrom: r.price_from == null ? null : Number(r.price_from),
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
      withRetry(async () =>
        rawAll<{ code: string; label: string }>(sql`SELECT code, label FROM vehicle_type`),
      ),
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
        const now = new Date().toISOString();
        const rows = await rawAll<{
          id: string;
          name: string;
          description: string | null;
          starts_at: string;
          ends_at: string;
          coupon_validity: string;
          all_brands: number;
        }>(sql`
          SELECT dc.id, dc.name, dc.description, dc.starts_at, dc.ends_at,
                 dc.coupon_validity, dc.all_brands
          FROM discount_campaign dc
          WHERE dc.paused = 0
            AND dc.starts_at <= ${now}
            AND dc.ends_at >= ${now}
          ORDER BY dc.starts_at DESC
        `);
        if (!rows.length) return [];

        const brands = await rawAll<{
          campaign_id: string;
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
        }>(sql`
          SELECT dcb.campaign_id, br.id, br.name, br.slug, br.logo_url
          FROM discount_campaign_brand dcb JOIN brand br ON br.id = dcb.brand_id
        `);
        const tiers = await rawAll<{
          campaign_id: string;
          id: string;
          amount: number;
          total_slots: number;
          claimed_slots: number;
        }>(sql`
          SELECT dt.campaign_id, dt.id, dt.amount, dt.total_slots, dt.claimed_slots
          FROM discount_tier dt ORDER BY dt.position ASC, dt.amount ASC
        `);

        const brandsBy = new Map<string, PublicCampaign["brands"]>();
        for (const b of brands) {
          const list = brandsBy.get(b.campaign_id) ?? [];
          list.push({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url });
          brandsBy.set(b.campaign_id, list);
        }
        const tiersBy = new Map<string, PublicCampaign["tiers"]>();
        for (const t of tiers) {
          const list = tiersBy.get(t.campaign_id) ?? [];
          list.push({
            id: t.id,
            amount: Number(t.amount),
            remaining: Math.max(0, Number(t.total_slots) - Number(t.claimed_slots)),
            totalSlots: Number(t.total_slots),
          });
          tiersBy.set(t.campaign_id, list);
        }

        return rows.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          startsAt: c.starts_at,
          endsAt: c.ends_at,
          couponValidity: c.coupon_validity,
          allBrands: !!c.all_brands,
          brands: brandsBy.get(c.id) ?? [],
          tiers: tiersBy.get(c.id) ?? [],
        }));
      }),
    { ttlMs: 30_000 },
  );
}

// ── Review tags ─────────────────────────────────────────────────

/** `GET /api/reviews/tags` — tags that appear on approved reviews. */
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

/** `GET /api/stats` — public landing-page counters. */
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
        const agg = rows[0] ?? { brands: 0, routes: 0, trips: 0, bookings: 0, confirmed: 0, reviews: 0, users: 0 };
        const stats: HomeStats = {};
        for (const [k, v] of Object.entries(agg)) stats[k] = Number(v);
        return stats;
      }),
    { ttlMs: 30_000 },
  );
}

// ── Invalidation hooks (call from admin write routes) ───────────

/** Brand writes (and brand-affecting route writes) — brands + stats. */
export const invalidateBrands = () => cacheInvalidatePrefix("lookups:brands:", "lookups:brand:", "lookups:stats");

/** Route / schedule writes — routes list + stats. */
export const invalidateRoutes = () => cacheInvalidatePrefix("lookups:routes:", "lookups:stats");

/** Vehicle-type catalog writes. */
export const invalidateVehicleTypes = () => cacheInvalidatePrefix("lookups:vehicle-types");

/** Place / FTS writes. */
export const invalidatePlaces = () => cacheInvalidatePrefix("lookups:places:");

/** Campaign / tier / coupon-claim writes (claims change remaining slots). */
export const invalidateCampaigns = () => cacheInvalidatePrefix("lookups:campaigns");

/** Review moderation — tags + stats. */
export const invalidateReviews = () => cacheInvalidatePrefix("lookups:review-tags:", "lookups:stats");

/** User / booking counters (stats). */
export const invalidateStats = () => cacheInvalidatePrefix("lookups:stats");
