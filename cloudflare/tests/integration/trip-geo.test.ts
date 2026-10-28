import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/db/schema";
import { parseSearchOptions } from "@/lib/services/trip-search-options";
import { searchTripsGeo, type LatLon } from "@/lib/services/trip-geo";
import { GET as geoRoute } from "../../src/app/api/search/geo/route";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";
import {
  addBrand,
  addLayout,
  addPickupPoints,
  addRoute,
  addSchedule,
  addTimetable,
  addTrip,
  resetCatalog,
  vnDay,
} from "../helpers/catalog";

/** Coordinate search end to end (`PublicService::search_trips_geo`). */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await resetCatalog();
});

const HANOI: LatLon = [21.03, 105.85];
const SAIGON: LatLon = [10.78, 106.7];
const date = vnDay(2);

const geo = (qs = "", max = 50, from: LatLon = HANOI, to: LatLon = SAIGON) =>
  searchTripsGeo(
    from,
    to,
    max,
    parseSearchOptions(new URLSearchParams(`date=${date}&${qs}`), true),
  );

/** A schedule with its own timetable, a trip on `date`, and the stops given. */
async function timed(stops: Parameters<typeof addTimetable>[2], time = "20:00") {
  const brandId = await addBrand();
  const layout = await addLayout(brandId, 4);
  const routeId = await addRoute(brandId);
  const scheduleId = await addSchedule(routeId, { busLayoutId: layout.id, departureTime: time });
  await addTimetable(brandId, scheduleId, stops);
  const tripId = await addTrip(scheduleId, date, { totalSeats: 4, availableSeats: 4 });
  return { brandId, routeId, scheduleId, tripId };
}

const NEAR_HANOI = { name: "Bến xe Giáp Bát", lat: 20.98, lon: 105.84, arrival: "20:30" };
const NEAR_SAIGON = { name: "Bến xe Miền Đông", lat: 10.81, lon: 106.71, arrival: "14:00" };

describe("coordinate search", () => {
  it("finds trips whose own stops are near both places and says where to board and leave", async () => {
    const { tripId } = await timed([NEAR_HANOI, NEAR_SAIGON]);
    const r = await geo();
    expect(r.items.map((i) => i.tripId)).toEqual([tripId]);
    expect(r.items[0]?.pickup).toEqual({ name: "Bến xe Giáp Bát", time: "20:30", distanceKm: 5.7 });
    expect(r.items[0]?.dropoff?.name).toBe("Bến xe Miền Đông");
    expect(r.items[0]?.dropoff?.time).toBe("14:00");
  });

  it("needs the drop-off after the pickup, and both within the distance", async () => {
    await timed([NEAR_SAIGON, NEAR_HANOI]);
    expect((await geo()).total).toBe(0);
    await timed([NEAR_HANOI, { name: "Far", lat: 16, lon: 108 }]);
    expect((await geo()).total).toBe(0);
    await timed([NEAR_HANOI, NEAR_SAIGON]);
    expect((await geo("", 1)).total).toBe(0); // 1 km: neither stop is that close
    expect((await geo("", 50)).total).toBe(1);
  });

  it("matches a schedule without a timetable on its route's pickup points", async () => {
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 4);
    const routeId = await addRoute(brandId);
    await addPickupPoints(routeId, [NEAR_HANOI, NEAR_SAIGON]);
    const scheduleId = await addSchedule(routeId, { busLayoutId: layout.id });
    const tripId = await addTrip(scheduleId, date, { totalSeats: 4, availableSeats: 4 });
    const r = await geo();
    expect(r.items.map((i) => i.tripId)).toEqual([tripId]);
    // Route points carry no time: the customer boards at the schedule's departure.
    expect(r.items[0]?.pickup).toEqual({
      name: "Bến xe Giáp Bát",
      time: undefined,
      distanceKm: 5.7,
    });
  });

  it("boards a schedule with a timetable only at its own stops, not at the route's points", async () => {
    const t = await timed([
      { name: "Elsewhere", lat: 12, lon: 109 },
      { name: "Else2", lat: 13, lon: 109 },
    ]);
    await addPickupPoints(t.routeId, [NEAR_HANOI, NEAR_SAIGON]);
    expect((await geo()).total).toBe(0);
  });

  it("sorts nearest stops first by default, and by the other keys on request", async () => {
    const far = await timed(
      [
        { ...NEAR_HANOI, lat: 21.2, arrival: "07:30" },
        { ...NEAR_SAIGON, lat: 10.9 },
      ],
      "07:00",
    );
    const near = await timed(
      [
        { ...NEAR_HANOI, lat: 21.04, arrival: "09:30" },
        { ...NEAR_SAIGON, lat: 10.79 },
      ],
      "09:00",
    );
    expect((await geo()).items.map((i) => i.tripId)).toEqual([near.tripId, far.tripId]);
    expect((await geo("sort=departure")).items.map((i) => i.tripId)).toEqual([
      far.tripId,
      near.tripId,
    ]);
  });

  it("applies departAfter to the time the bus reaches the pickup stop", async () => {
    // Leaves at 20:00, reaches the Hà Nội stop at 20:30.
    const { tripId } = await timed([NEAR_HANOI, NEAR_SAIGON]);
    expect((await geo("departAfter=20:15")).items.map((i) => i.tripId)).toEqual([tripId]);
    expect((await geo("departAfter=20:45")).total).toBe(0);
  });

  it("leaves out inactive routes and applies the shared filters", async () => {
    const a = await timed([NEAR_HANOI, NEAR_SAIGON]);
    const b = await timed([NEAR_HANOI, NEAR_SAIGON]);
    await (
      await getDb()
    )
      .update(routes)
      .set({ status: "inactive" })
      .where(eq(routes.id, b.routeId));
    const r = await geo();
    expect(r.items.map((i) => i.tripId)).toEqual([a.tripId]);
    expect(r.facets?.matches).toBe(1);
    expect((await geo("minRating=4")).total).toBe(0);
  });

  it("fills a missing trip inline for a coming date", async () => {
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 4);
    const routeId = await addRoute(brandId);
    const scheduleId = await addSchedule(routeId, { busLayoutId: layout.id });
    await addTimetable(brandId, scheduleId, [NEAR_HANOI, NEAR_SAIGON]);
    expect((await geo()).items[0]).toMatchObject({ scheduleId, totalSeats: 4 });
  });

  it("clamps the distance to 1..200 km and answers over HTTP", async () => {
    await timed([NEAR_HANOI, NEAR_SAIGON]);
    const q = `fromLat=21.03&fromLon=105.85&toLat=10.78&toLon=106.7&date=${date}`;
    const res = await geoRoute(
      new Request(`https://datxevui.com/api/search/geo?${q}&maxDistanceKm=0`),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(0); // 0 → 1 km
    const ok = await geoRoute(new Request(`https://datxevui.com/api/search/geo?${q}`));
    expect((await ok.json()).total).toBe(1);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("answers 400 for missing coordinates", async () => {
    const res = await geoRoute(
      new Request(
        `https://datxevui.com/api/search/geo?fromLat=21&fromLon=105&toLat=10&date=${date}`,
      ),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("toLon: missing field");
  });
});
