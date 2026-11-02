/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { addresses, reviews } from "@/lib/db/schema";
import { GET as profileRoute } from "../../src/app/api/brands/[slug]/profile/route";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";
import {
  addBrand,
  addRoute,
  addSchedule,
  addTrip,
  addVehicleType,
  resetCatalog,
  vnDay,
} from "../helpers/catalog";

/** `GET /api/brands/{slug}/profile`: a brand's page in one read. */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await resetCatalog();
});

const profile = async (slug: string, cookie?: string) => {
  const res = await profileRoute(
    new Request(`https://datxevui.com/api/brands/${slug}/profile`, {
      headers: cookie ? { cookie } : undefined,
    }),
    { params: Promise.resolve({ slug }) },
  );
  return { res, body: (await res.json()) as any };
};

describe("brand profile", () => {
  it("answers 404 for an unknown or inactive brand", async () => {
    await addBrand({ slug: "gone", status: "inactive" });
    expect((await profile("gone")).res.status).toBe(404);
    expect((await profile("nope")).res.status).toBe(404);
  });

  it("carries the brand, its routes with timetables, and its upcoming trips", async () => {
    const brandId = await addBrand({
      slug: "sao-viet",
      name: "Sao Việt",
      description: "Xe giường nằm",
      contactPhone: "0900000000",
      rating: 4.5,
    });
    const limousine = await addVehicleType({ code: "limousine", label: "Limousine" });
    const hanoiHue = await addRoute(brandId, "ha-noi", "hue", { name: "Hà Nội - Huế" });
    const early = await addSchedule(hanoiHue, {
      departureTime: "06:00",
      basePriceAdult: 300_000,
      vehicleTypeId: limousine,
    });
    const late = await addSchedule(hanoiHue, { departureTime: "21:00", basePriceAdult: 250_000 });
    await addRoute(brandId, "ha-noi", "hai-phong", { name: "Closed", status: "inactive" });
    await addRoute(brandId); // a route with no schedule has no price

    const tomorrow = vnDay(1);
    const tripEarly = await addTrip(early, tomorrow, { availableSeats: 12, totalSeats: 34 });
    await addTrip(late, tomorrow);
    await addTrip(late, tomorrow, {}).catch(() => undefined); // same schedule + date: unique
    await addTrip(early, vnDay(9)); // beyond the window
    await addTrip(early, vnDay(2), { status: "cancelled" });

    const { res, body } = await profile("sao-viet");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(body.brand).toMatchObject({
      slug: "sao-viet",
      name: "Sao Việt",
      description: "Xe giường nằm",
      contactPhone: "0900000000",
      rating: 4.5,
      reviewCount: 0,
    });

    expect(body.routes.map((r: any) => r.name)).toEqual(["Hà Nội - Huế", "ha-noi - ho-chi-minh"]);
    const [hue, bare] = body.routes;
    expect(hue).toMatchObject({ id: hanoiHue, priceFrom: 250_000, from: { name: "Hà Nội" } });
    expect(hue.schedules.map((s: any) => [s.departureTime, s.priceAdult, s.vehicleType])).toEqual([
      ["06:00", 300_000, "Limousine"],
      ["21:00", 250_000, null],
    ]);
    expect(bare).toMatchObject({ priceFrom: null, schedules: [] });

    expect(body.trips.map((t: any) => [t.date, t.departureTime])).toEqual([
      [tomorrow, "06:00"],
      [tomorrow, "21:00"],
    ]);
    expect(body.trips[0]).toMatchObject({
      tripId: tripEarly,
      routeId: hanoiHue,
      availableSeats: 12,
      totalSeats: 34,
      vehicleType: "Limousine",
      priceAdult: 300_000,
    });
  });

  it("leaves out another brand's routes, trips and trips already gone", async () => {
    const mine = await addBrand({ slug: "mine" });
    const other = await addBrand({ slug: "other" });
    const myRoute = await addRoute(mine);
    const theirRoute = await addRoute(other);
    const mySchedule = await addSchedule(myRoute, { departureTime: "00:00" });
    const theirSchedule = await addSchedule(theirRoute);
    await addTrip(theirSchedule, vnDay(1));
    await addTrip(mySchedule, vnDay(-1)); // yesterday
    await addTrip(mySchedule, vnDay(0)); // 00:00 today has left
    // A window that closed yesterday never departs again.
    const gone = await addSchedule(myRoute, { effectiveTo: vnDay(-1) });
    await addTrip(gone, vnDay(1));

    const { body } = await profile("mine");
    expect(body.routes).toHaveLength(1);
    expect(body.routes[0].schedules).toHaveLength(1);
    expect(body.trips).toEqual([]);
  });

  it("lists the brand's locations by city, and counts only approved reviews", async () => {
    const brandId = await addBrand({ slug: "sao-viet" });
    const other = await addBrand({ slug: "other" });
    const db = await getDb();
    await db.insert(addresses).values([
      { id: "a1", brandId, name: "Văn phòng B", address: "2 Lê Lợi", province: "Huế" },
      { id: "a2", brandId, name: "Văn phòng A", address: "1 Hàng Bài", province: "Hà Nội" },
      { id: "a3", brandId: other, name: "Not mine", province: "Hà Nội" },
    ]);
    await db.insert(reviews).values([
      { id: "r1", brandId, rating: 5, status: "approved" },
      { id: "r2", brandId, rating: 1, status: "pending" },
      { id: "r3", brandId: other, rating: 5, status: "approved" },
    ]);
    const { body } = await profile("sao-viet");
    expect(body.locations.map((l: any) => [l.name, l.city])).toEqual([
      ["Văn phòng A", "Hà Nội"],
      ["Văn phòng B", "Huế"],
    ]);
    expect(body.brand.reviewCount).toBe(1);
  });

  it("is never cached for a signed-in caller", async () => {
    await addBrand({ slug: "sao-viet" });
    const { res } = await profile("sao-viet", "refresh_token=x");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
