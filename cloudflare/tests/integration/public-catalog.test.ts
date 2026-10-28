/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tripSessions } from "@/lib/db/schema";
import { recommendedTrips } from "@/lib/services/trip-recommendations";
import { GET as brandsRoute } from "../../src/app/api/brands/route";
import { GET as brandRoute } from "../../src/app/api/brands/[slug]/route";
import { GET as routesRoute } from "../../src/app/api/routes/route";
import { GET as statsRoute } from "../../src/app/api/stats/route";
import { GET as recommendationsRoute } from "../../src/app/api/recommendations/route";
import { GET as reverseRoute } from "../../src/app/api/places/reverse/route";
import { GET as placesSearchRoute } from "../../src/app/api/places/search/route";
import { GET as placesRoute } from "../../src/app/api/places/route";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";
import {
  addBrand,
  addLayout,
  addRoute,
  addSchedule,
  addTrip,
  resetCatalog,
  vnDay,
} from "../helpers/catalog";

/** Brands, routes, stats and recommendations (`PublicService` + `routes/public.rs`). */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await resetCatalog();
});

const url = (path: string) => new Request(`https://datxevui.com${path}`);
const call = async (route: (r: Request) => Promise<Response>, path: string) => {
  const res = await route(url(path));
  return { res, body: await res.json() };
};

describe("brands", () => {
  it("lists active brands, best rated first, with their active route counts", async () => {
    const top = await addBrand({ name: "Top", rating: 4.9 });
    await addBrand({ name: "Low", rating: 3.2 });
    await addBrand({ name: "Hidden", status: "inactive", rating: 5 });
    await addRoute(top);
    await addRoute(top);
    await addRoute(top, "ha-noi", "hue", { status: "inactive" });
    const { res, body } = await call(brandsRoute, "/api/brands");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body.items.map((b: any) => [b.name, b.routeCount])).toEqual([
      ["Top", 2],
      ["Low", 0],
    ]);
  });

  it("clamps the limit to 1..200 and answers 400 to one that is not a number", async () => {
    await addBrand();
    await addBrand();
    expect((await call(brandsRoute, "/api/brands?limit=0")).body.items).toHaveLength(1);
    expect((await call(brandsRoute, "/api/brands?limit=1000")).body.items).toHaveLength(2);
    expect((await call(brandsRoute, "/api/brands?limit=many")).res.status).toBe(400);
  });

  it("shows an active brand's detail, and 404 for an unknown or inactive one", async () => {
    await addBrand({ slug: "sao-viet", name: "Sao Việt", description: "d", contactPhone: "0123" });
    await addBrand({ slug: "gone", status: "inactive" });
    const ok = await brandRoute(url("/api/brands/sao-viet"), {
      params: Promise.resolve({ slug: "sao-viet" }),
    });
    expect(await ok.json()).toMatchObject({ slug: "sao-viet", name: "Sao Việt", description: "d" });
    for (const slug of ["gone", "nope"]) {
      const res = await brandRoute(url(`/api/brands/${slug}`), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).message).toBe("resource not found: brand not found");
    }
  });

  it("is never cached for a signed-in caller", async () => {
    const res = await brandsRoute(
      new Request("https://datxevui.com/api/brands", { headers: { cookie: "refresh_token=x" } }),
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("routes", () => {
  it("lists active routes by name with brand preview, endpoints, schedule count and lowest price", async () => {
    const brandId = await addBrand({ name: "Sao Việt", rating: 4.2 });
    const b = await addRoute(brandId, "ha-noi", "da-nang", { name: "B route" });
    const a = await addRoute(brandId, "ha-noi", "hue", { name: "A route" });
    await addRoute(brandId, "ha-noi", "hai-phong", { name: "C route", status: "inactive" });
    await addSchedule(a, { basePriceAdult: 250_000 });
    await addSchedule(a, { basePriceAdult: 180_000 });
    const { body } = await call(routesRoute, "/api/routes");
    expect(body.items.map((r: any) => r.name)).toEqual(["A route", "B route"]);
    expect(body.items[0]).toMatchObject({
      id: a,
      brandId,
      brand: { name: "Sao Việt", rating: 4.2 },
      from: { name: "Hà Nội" },
      to: { name: "Thừa Thiên Huế" },
      scheduleCount: 2,
      priceFrom: 180_000,
    });
    expect(body.items[1]).toMatchObject({ id: b, scheduleCount: 0 });
    expect(body.items[1].priceFrom).toBeUndefined();
  });

  it("filters by brand_id, the parameter the SPA sends", async () => {
    const one = await addBrand();
    const two = await addBrand();
    const mine = await addRoute(one);
    await addRoute(two);
    await addRoute(one, "ha-noi", "hue", { status: "inactive" });
    const { body } = await call(routesRoute, `/api/routes?brand_id=${one}`);
    expect(body.items.map((r: any) => r.id)).toEqual([mine]);
    expect((await call(routesRoute, "/api/routes?brand_id=nope")).res.status).toBe(400);
  });

  it("gives a route with no brand an empty preview, and splits the name when the cities are unknown", async () => {
    await addRoute(null, "zz-1", "zz-2", { name: "Chợ Lớn → Bến Thành" });
    const { body } = await call(routesRoute, "/api/routes");
    expect(body.items[0].brand).toEqual({});
    expect(body.items[0].brandId).toBeUndefined();
    expect(body.items[0].from.name).toBe("Chợ Lớn");
    expect(body.items[0].to.name).toBe("Bến Thành");
  });

  it("clamps the limit to 1..500", async () => {
    const brandId = await addBrand();
    await addRoute(brandId);
    await addRoute(brandId, "ha-noi", "hue");
    expect((await call(routesRoute, "/api/routes?limit=0")).body.items).toHaveLength(1);
    expect((await call(routesRoute, "/api/routes?limit=9999")).body.items).toHaveLength(2);
  });
});

describe("stats", () => {
  it("counts active brands and routes and the scheduled trips from today in Vietnam, and nothing else", async () => {
    const brandId = await addBrand();
    await addBrand({ status: "inactive" });
    const routeId = await addRoute(brandId);
    await addRoute(brandId, "ha-noi", "hue", { status: "inactive" });
    const scheduleId = await addSchedule(routeId);
    await addTrip(scheduleId, vnDay(0));
    await addTrip(scheduleId, vnDay(1));
    await addTrip(scheduleId, vnDay(2), { status: "cancelled" });
    await addTrip(scheduleId, vnDay(-1));
    const { res, body } = await call(statsRoute, "/api/stats");
    expect(body).toEqual({ brands: 1, routes: 1, trips: 2 });
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });
});

describe("recommendations", () => {
  async function trips(n: number) {
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 3);
    const routeId = await addRoute(brandId);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const scheduleId = await addSchedule(routeId, {
        busLayoutId: layout.id,
        departureTime: `${10 + i}:00`,
      });
      out.push(await addTrip(scheduleId, vnDay(2), { totalSeats: 3, availableSeats: 3 }));
    }
    return { brandId, routeId, layout, trips: out };
  }

  it("returns at most four upcoming trips, soonest first, and only the items", async () => {
    const { trips: made } = await trips(6);
    const { body } = await call(recommendationsRoute, "/api/recommendations");
    expect(Object.keys(body)).toEqual(["items"]);
    expect(body.items.map((i: any) => i.tripId)).toEqual(made.slice(0, 4));
  });

  it("skips sold-out, cancelled and departed trips", async () => {
    const { trips: made, routeId, layout } = await trips(3);
    const db = await getDb();
    await db.update(tripSessions).set({ availableSeats: 0 }).where(eq(tripSessions.id, made[0]!));
    await db.update(tripSessions).set({ status: "cancelled" }).where(eq(tripSessions.id, made[1]!));
    const left = await addSchedule(routeId, { busLayoutId: layout.id, departureTime: "00:00" });
    await addTrip(left, vnDay(0), { totalSeats: 3, availableSeats: 3 });
    expect((await recommendedTrips()).items.map((i) => i.tripId)).toEqual([made[2]]);
  });

  it("fills a cold database so the carousel is not empty", async () => {
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 3);
    const routeId = await addRoute(brandId);
    await addSchedule(routeId, { busLayoutId: layout.id });
    const { items } = await recommendedTrips();
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
  });

  it("is empty with nothing to sell", async () => {
    expect(await recommendedTrips()).toEqual({ items: [] });
  });
});

describe("places", () => {
  it("answers 400 to a missing or unreadable parameter before touching the index", async () => {
    expect((await reverseRoute(url("/api/places/reverse?lat=10"))).status).toBe(400);
    expect((await reverseRoute(url("/api/places/reverse?lat=a&lon=b"))).status).toBe(400);
    expect((await placesSearchRoute(url("/api/places/search"))).status).toBe(400);
    expect((await placesSearchRoute(url("/api/places/search?q=x&limit=-2"))).status).toBe(400);
    expect((await placesRoute(url("/api/places?offset=x"))).status).toBe(400);
  });
});
