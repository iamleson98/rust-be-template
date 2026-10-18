import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration4 from "../../migrations/0004_deep_callisto.sql?raw";
import { applyMigrations } from "../helpers/migrate";
import { getDb, rawAll } from "@/lib/db/client";
import { brands, routes } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { countOf, groupedCounts } from "@/lib/db/counts";
import { listBrands } from "@/lib/services/lookups";
import { adminBrandList, adminRouteList } from "@/lib/services/admin-out";

/**
 * Regression tests for the batched grouped-count pattern (db/counts.ts).
 *
 * The bug these lock down: the correlated per-row count subqueries they
 * replaced rendered their interpolated outer-table columns UNQUALIFIED in
 * drizzle select fields (`WHERE r.brand_id = "id"`), and SQLite resolved
 * `"id"` against the subquery's own tables — so every count silently came
 * back 0 while real rows existed (brands showed "0 tuyến", the bookings
 * CSV exported `seats=0`, admin lists showed all-zero counts).
 */
beforeAll(async () => {
  await applyMigrations(migration0, migration1, migration2, migration4);
});

const now = new Date().toISOString();

async function seedBrandWithRoutes(
  name: string,
  slug: string,
  routeNames: Array<string>,
  status = "active",
): Promise<string> {
  const db = await getDb();
  const brandId = crypto.randomUUID();
  await db.insert(brands).values({
    id: brandId,
    slug,
    name,
    status: "active",
    rating: 4.5,
    createdAt: now,
    updatedAt: now,
  });
  for (const routeName of routeNames) {
    await db.insert(routes).values({
      id: crypto.randomUUID(),
      brandId,
      name: routeName,
      status,
      startLocationId: "ha-noi",
      endLocationId: "da-nang",
      createdAt: now,
      updatedAt: now,
    });
  }
  return brandId;
}

describe("groupedCounts", () => {
  it("counts per key in one round trip and zeroes absent ids", async () => {
    const withRoutes = await seedBrandWithRoutes("Count A", "count-a", ["r1", "r2", "r3"]);
    const withoutRoutes = await seedBrandWithRoutes("Count B", "count-b", []);
    const map = await groupedCounts(routes, routes.brandId, [withRoutes, withoutRoutes]);
    expect(map.get(withRoutes)).toBe(3);
    expect(map.get(withoutRoutes)).toBe(0);
  });

  it("applies the extra filter (active-only counts)", async () => {
    const brandId = await seedBrandWithRoutes("Count C", "count-c", ["live", "dead"], "inactive");
    const liveOnly = await groupedCounts(
      routes,
      routes.brandId,
      [brandId],
      eq(routes.status, "active"),
    );
    const all = await groupedCounts(routes, routes.brandId, [brandId]);
    expect(liveOnly.get(brandId)).toBe(0); // both seeded rows are inactive
    expect(all.get(brandId)).toBe(2);
  });

  it("chunks past D1's 100-bound-parameter cap (200 ids → 3 queries)", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `no-such-brand-${i}`);
    const map = await groupedCounts(routes, routes.brandId, ids);
    expect(map.size).toBe(200);
    for (const id of ids) expect(map.get(id)).toBe(0);
  });

  it("countOf reads the map explicitly (null id and absent key are zero)", () => {
    const map = new Map([["a", 7]]);
    expect(countOf(map, "a")).toBe(7);
    expect(countOf(map, "missing")).toBe(0);
    expect(countOf(map, null)).toBe(0);
  });
});

describe("listBrands — route counts (the '0 tuyến' regression)", () => {
  it("returns REAL per-brand route counts, not zeros", async () => {
    await seedBrandWithRoutes("Zero Routes", "zero-routes", []);
    const one = await seedBrandWithRoutes("One Route", "one-route", ["only"]);
    await seedBrandWithRoutes("Three Routes", "three-routes", ["r1", "r2", "r3"]);
    const items = await listBrands(50);
    const bySlug = new Map(items.map((b) => [b.slug, b.routeCount]));
    expect(bySlug.get("zero-routes")).toBe(0);
    expect(bySlug.get("one-route")).toBe(1);
    expect(bySlug.get("three-routes")).toBe(3);
    // Cross-check one brand against a direct SQL count.
    const direct = await rawAll<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM route WHERE brand_id = ${one} AND status = 'active'`,
    );
    expect(Number(direct[0]?.n)).toBe(1);
  });
});

describe("adminBrandList / adminRouteList — batched counts", () => {
  it("brand list carries route + layout counts", async () => {
    const brandId = await seedBrandWithRoutes("Admin Count", "admin-count", ["x", "y"]);
    const items = await adminBrandList();
    const mine = items.find((b) => b.id === brandId);
    expect(mine?.routeCount).toBe(2);
    expect(mine?.layoutCount).toBe(0);
  });

  it("route list carries schedule counts", async () => {
    const brandId = await seedBrandWithRoutes("Route Count", "route-count", ["scheduled"]);
    const page = await adminRouteList({ limit: 200, offset: 0 });
    const mine = page.items.find((r) => r.brandId === brandId);
    expect(mine).toBeDefined();
    expect(mine?.scheduleCount).toBe(0); // no schedules seeded for it
  });
});
