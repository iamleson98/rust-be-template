import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { brands, routes, schedules, seatInventory, tripSessions } from "@/lib/db/schema";
import { searchTrips } from "@/lib/services/trip-search";
import { parseSearchOptions, type SearchOptions } from "@/lib/services/trip-search-options";
import { warmTrips, SELL_WINDOW_DAYS } from "@/lib/services/trip-warmer";
import { GET as searchRoute } from "../../src/app/api/search/route";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";
import {
  addBrand,
  addFare,
  addLayout,
  addRoute,
  addSchedule,
  addTimetable,
  addTrip,
  addVehicleType,
  nextWeekday,
  openTrip,
  resetCatalog,
  tripRows,
  vnDay,
} from "../helpers/catalog";

/** City search end to end, against the real D1 schema (`PublicService::search_trips`). */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await resetCatalog();
});

const opts = (date: string, qs = ""): SearchOptions =>
  parseSearchOptions(new URLSearchParams(`date=${date}&${qs}`), false);
const search = (date: string, qs = "", from = "Hà Nội", to = "Hồ Chí Minh") =>
  searchTrips(from, to, opts(date, qs));
const ids = (r: Awaited<ReturnType<typeof search>>) => r.items.map((i) => i.tripId);

/** A brand with one route and one schedule, optionally with a trip on `date`. */
async function lane(date: string | null, over: { from?: string; to?: string; time?: string } = {}) {
  const brandId = await addBrand();
  const layout = await addLayout(brandId, 4);
  const routeId = await addRoute(brandId, over.from ?? "ha-noi", over.to ?? "ho-chi-minh");
  const scheduleId = await addSchedule(routeId, {
    busLayoutId: layout.id,
    departureTime: over.time ?? "08:00",
  });
  const tripId = date
    ? await addTrip(scheduleId, date, { totalSeats: 4, availableSeats: 4 })
    : null;
  return { brandId, layout, routeId, scheduleId, tripId };
}

describe("finding trips", () => {
  it("finds a city pair by name, accents and alias, in that direction only", async () => {
    const date = vnDay(2);
    const { tripId } = await lane(date);
    for (const [from, to] of [
      ["Hà Nội", "TP. Hồ Chí Minh"],
      ["ha noi", "Sài Gòn"],
      ["hn", "hcm"],
    ])
      expect(ids(await search(date, "", from, to)), `${from} → ${to}`).toEqual([tripId]);
    expect(ids(await search(date, "", "Sài Gòn", "Hà Nội"))).toEqual([]);
    expect(ids(await search(date, "", "Đà Nẵng", "Huế"))).toEqual([]);
  });

  it("returns the card the SPA reads", async () => {
    const date = vnDay(3);
    const { tripId, scheduleId, routeId, brandId } = await lane(date);
    const [card] = (await search(date)).items;
    expect(card).toMatchObject({
      tripId,
      scheduleId,
      routeId,
      brandId,
      departureDate: date,
      status: "scheduled",
      availableSeats: 4,
      totalSeats: 4,
      fromName: "Hà Nội",
      toName: "TP. Hồ Chí Minh",
      departureTime: "08:00",
      departureAt: `${date}T08:00:00`,
      priceAdult: 200_000,
      priceChild: 0,
      vehicleType: "standard",
      vehicleTypeLabel: "Ghế ngồi",
      capacity: 4,
      amenities: [],
    });
    expect(card?.fromLat).toBeCloseTo(21.03);
  });

  it("matches a route by its name when its endpoints are not known cities, origin before destination", async () => {
    const date = vnDay(2);
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 2);
    const routeId = await addRoute(brandId, "x-1", "x-2", {
      name: "Quận 1 - Sân bay Tân Sơn Nhất",
    });
    const scheduleId = await addSchedule(routeId, { busLayoutId: layout.id });
    const tripId = await addTrip(scheduleId, date, { availableSeats: 2 });
    expect(ids(await search(date, "", "quận 1", "sân bay"))).toEqual([tripId]);
    // The SQL name match is order-blind; the direction check is not.
    expect(ids(await search(date, "", "sân bay", "quận 1"))).toEqual([]);
  });

  it("leaves out cancelled, sold-out, departed and inactive-route trips", async () => {
    const date = vnDay(2);
    const a = await lane(date);
    const sold = await lane(date);
    const cancelled = await lane(date);
    const inactive = await lane(date);
    const d = await getDb();
    await d
      .update(tripSessions)
      .set({ availableSeats: 0 })
      .where(eq(tripSessions.id, sold.tripId!));
    await d
      .update(tripSessions)
      .set({ status: "cancelled" })
      .where(eq(tripSessions.id, cancelled.tripId!));
    await d.update(routes).set({ status: "inactive" }).where(eq(routes.id, inactive.routeId));
    expect(ids(await search(date))).toEqual([a.tripId]);
    // A trip that left this morning is no longer on sale.
    const left = await lane(vnDay(0), { time: "00:00" });
    expect(ids(await search(vnDay(0)))).not.toContain(left.tripId);
  });

  it("requires minSeats seats", async () => {
    const date = vnDay(2);
    await lane(date);
    expect((await search(date, "minSeats=4")).total).toBe(1);
    expect((await search(date, "minSeats=5")).total).toBe(0);
  });

  it("answers 400 without a departure or an arrival", async () => {
    await expect(search(vnDay(1), "", "  ", "Hà Nội")).rejects.toMatchObject({
      status: 400,
      message: "missing departure location (from)",
    });
    await expect(search(vnDay(1), "", "Hà Nội", "")).rejects.toMatchObject({
      status: 400,
      message: "missing arrival location (to)",
    });
  });

  it("hides the trips of a deactivated brand (Rust keeps selling them; see the audit)", async () => {
    const date = vnDay(2);
    const { brandId, tripId } = await lane(date);
    await (await getDb()).update(brands).set({ status: "inactive" }).where(eq(brands.id, brandId));
    expect(tripId).toBeTruthy();
    expect(ids(await search(date))).toEqual([]);
  });
});

describe("prices", () => {
  it("quotes the seats for sale where the trip was opened", async () => {
    const date = vnDay(2);
    const { tripId, layout } = await lane(date);
    await openTrip(
      tripId!,
      layout.seatIds,
      [150_000, 180_000, 200_000, 260_000],
      ["booked", "available", "available", "available"],
    );
    const [card] = (await search(date)).items;
    expect([card?.minPrice, card?.maxPrice]).toEqual([180_000, 260_000]);
  });

  it("quotes the layout's seat classes at the schedule's fares where nobody opened it", async () => {
    const date = vnDay(2);
    const brandId = await addBrand();
    const layout = await addLayout(brandId, [
      { label: "A1" },
      { label: "B1", seatClass: "vip" },
      { label: "C1", seatClass: "bed_upper" },
    ]);
    const routeId = await addRoute(brandId);
    const scheduleId = await addSchedule(routeId, {
      busLayoutId: layout.id,
      basePriceAdult: 300_000,
    });
    await addFare(scheduleId, "vip", 450_000);
    await addFare(scheduleId, "bed_upper", 280_000);
    await addFare(scheduleId, "unused_class", 10_000);
    await addTrip(scheduleId, date, { totalSeats: 3, availableSeats: 3 });
    const [card] = (await search(date)).items;
    // standard 300 000, vip 450 000, bed_upper 280 000 — a fare for a class no seat has is ignored.
    expect([card?.minPrice, card?.maxPrice]).toEqual([280_000, 450_000]);
  });

  it("falls back to the base price without a layout", async () => {
    const date = vnDay(2);
    const brandId = await addBrand();
    const routeId = await addRoute(brandId);
    const scheduleId = await addSchedule(routeId, { basePriceAdult: 123_000 });
    await addTrip(scheduleId, date, { totalSeats: 9, availableSeats: 9 });
    const [card] = (await search(date)).items;
    expect([card?.minPrice, card?.maxPrice]).toEqual([123_000, 123_000]);
  });
});

describe("filters, facets, sort and paging", () => {
  async function market() {
    const date = vnDay(2);
    const cheap = await lane(date, { time: "06:00" });
    const dear = await lane(date, { time: "21:00" });
    const db = await getDb();
    await db.update(brands).set({ rating: 4.9, name: "Zeta" }).where(eq(brands.id, dear.brandId));
    await db.update(brands).set({ rating: 3.0, name: "Alpha" }).where(eq(brands.id, cheap.brandId));
    await db
      .update(schedules)
      .set({ basePriceAdult: 100_000, amenities: '["wifi"]' })
      .where(eq(schedules.id, cheap.scheduleId));
    await db
      .update(schedules)
      .set({ basePriceAdult: 400_000, amenities: "wifi,ac" })
      .where(eq(schedules.id, dear.scheduleId));
    await db
      .update(tripSessions)
      .set({ availableSeats: 3 })
      .where(eq(tripSessions.id, cheap.tripId!));
    await db
      .update(tripSessions)
      .set({ totalSeats: 10, availableSeats: 10 })
      .where(eq(tripSessions.id, dear.tripId!));
    return { date, cheap, dear };
  }

  it("counts the filter options over every trip, whatever the filters", async () => {
    const { date } = await market();
    const r = await search(date, "amenities=ac");
    expect(r.total).toBe(1);
    expect(r.facets).toMatchObject({
      matches: 2,
      priceMin: 100_000,
      priceMax: 400_000,
      plentyOfSeats: 1,
    });
    expect(r.facets?.brands.map((b) => b.label)).toEqual(["Alpha", "Zeta"]);
    expect(r.facets?.hours.map((h) => h.count)).toEqual([0, 1, 0, 1]);
    expect(r.facets?.amenities).toEqual([
      { key: "wifi", label: "WiFi", count: 2 },
      { key: "ac", label: "Điều hòa", count: 1 },
    ]);
  });

  it("filters and sorts", async () => {
    const { date, cheap, dear } = await market();
    expect(ids(await search(date))).toEqual([cheap.tripId, dear.tripId]); // by departure
    expect(ids(await search(date, "sort=price"))).toEqual([cheap.tripId, dear.tripId]);
    expect(ids(await search(date, "sort=rating"))).toEqual([dear.tripId, cheap.tripId]);
    expect(ids(await search(date, "minRating=4"))).toEqual([dear.tripId]);
    expect(ids(await search(date, "plentyOfSeats=true"))).toEqual([dear.tripId]);
    expect(ids(await search(date, "priceMax=150000"))).toEqual([cheap.tripId]);
    expect(ids(await search(date, "hours=18-24"))).toEqual([dear.tripId]);
    expect(ids(await search(date, "departAfter=12:00"))).toEqual([dear.tripId]);
    expect(ids(await search(date, `brands=${cheap.brandId}`))).toEqual([]); // slugs, not ids
  });

  it("pages with a stable order and reports whether more follow", async () => {
    const { date, cheap, dear } = await market();
    const first = await search(date, "limit=1");
    expect(first).toMatchObject({ total: 2, limit: 1, offset: 0, hasMore: true });
    const second = await search(date, "limit=1&offset=1");
    expect(ids(first).concat(ids(second))).toEqual([cheap.tripId, dear.tripId]);
    expect(second.hasMore).toBe(false);
  });

  it("answers an empty search with page metadata and empty facets", async () => {
    const r = await search(vnDay(5));
    expect(r).toMatchObject({ items: [], total: 0, limit: 20, offset: 0, hasMore: false });
    expect(r.facets?.matches).toBe(0);
  });

  it("derives the arrival from the last timed stop, rolling an overnight trip over", async () => {
    const date = vnDay(2);
    const { brandId, scheduleId } = await lane(date, { time: "22:00" });
    await addTimetable(brandId, scheduleId, [
      { name: "A", lat: 21, lon: 105.8, arrival: "22:00" },
      { name: "B", lat: 10.8, lon: 106.7, arrival: "06:30" },
    ]);
    expect((await search(date)).items[0]?.arrivalAt).toBe(`${vnDay(3)}T06:30:00`);
  });

  it("serves the same answer over HTTP, with the public cache header", async () => {
    const date = vnDay(2);
    const { tripId } = await lane(date);
    const url = `https://datxevui.com/api/search?from=H%C3%A0%20N%E1%BB%99i&to=hcm&date=${date}`;
    const res = await searchRoute(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await res.json()).items[0].tripId).toBe(tripId);
    const signedIn = await searchRoute(new Request(url, { headers: { cookie: "access_token=x" } }));
    expect(signedIn.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 400 to a bad query, with the SDK's error body", async () => {
    for (const [qs, message] of [
      ["from=a&to=b&date=nope", "date must be YYYY-MM-DD"],
      [
        "from=a&to=b&date=2026-10-12&limit=x",
        "Failed to deserialize query string: limit: invalid digit found in string",
      ],
      ["to=b&date=2026-10-12", "Failed to deserialize query string: from: missing field"],
      [
        "from=a&to=b&date=2026-10-12&hours=9",
        'hours: unknown band "9" (use 0-6, 6-12, 12-18, 18-24)',
      ],
    ] as const) {
      const res = await searchRoute(new Request(`https://datxevui.com/api/search?${qs}`));
      expect(res.status, qs).toBe(400);
      expect((await res.json()).error.message, qs).toBe(message);
    }
  });
});

describe("trips created on demand", () => {
  it("fills a schedule with no trip for the searched date, with its layout's seat count", async () => {
    const date = vnDay(3);
    const { scheduleId } = await lane(null);
    const r = await search(date);
    expect(r.total).toBe(1);
    expect(r.items[0]).toMatchObject({ availableSeats: 4, totalSeats: 4, departureDate: date });
    expect(await tripRows(scheduleId)).toHaveLength(1);
    // A second search finds the row rather than creating another.
    await search(date);
    expect(await tripRows(scheduleId)).toHaveLength(1);
  });

  it("honours the weekday mask: Monday to Friday does not run on Saturday", async () => {
    const { scheduleId } = await lane(null);
    await (
      await getDb()
    )
      .update(schedules)
      .set({ daysOfWeek: "1111100" })
      .where(eq(schedules.id, scheduleId));
    expect((await search(nextWeekday(6))).total).toBe(0);
    expect(await tripRows(scheduleId)).toHaveLength(0);
    expect((await search(nextWeekday(5))).total).toBe(1);
    expect(await tripRows(scheduleId)).toHaveLength(1);
  });

  it("stays inside the schedule's effective window and never fills the past", async () => {
    const { scheduleId } = await lane(null);
    await (
      await getDb()
    )
      .update(schedules)
      .set({ effectiveFrom: vnDay(5), effectiveTo: vnDay(6) })
      .where(eq(schedules.id, scheduleId));
    expect((await search(vnDay(4))).total).toBe(0);
    expect((await search(vnDay(7))).total).toBe(0);
    expect((await search(vnDay(-1))).total).toBe(0);
    expect(await tripRows(scheduleId)).toHaveLength(0);
    expect((await search(vnDay(5))).total).toBe(1);
  });

  it("does not inflate a shared layout's capacity, however many schedules use it", async () => {
    const date = vnDay(3);
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 3);
    const routeId = await addRoute(brandId);
    const schedulesOfLayout = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        addSchedule(routeId, { busLayoutId: layout.id, departureTime: `0${i + 1}:00` }),
      ),
    );
    const r = await search(date, "limit=100");
    expect(r.total).toBe(6);
    expect(new Set(r.items.map((i) => i.totalSeats))).toEqual(new Set([3]));
    for (const id of schedulesOfLayout) expect((await tripRows(id))[0]?.totalSeats).toBe(3);
  });

  it("sells a layout-less schedule by its vehicle type's seat count, and skips one with no capacity", async () => {
    const date = vnDay(3);
    const brandId = await addBrand();
    const routeId = await addRoute(brandId);
    const bus = await addVehicleType({ code: "minivan", label: "Minivan 16", totalSeats: 16 });
    const sized = await addSchedule(routeId, { vehicleTypeId: bus, departureTime: "09:00" });
    const bare = await addSchedule(routeId, { departureTime: "10:00" });
    const empty = await addLayout(brandId, 0);
    const emptyLayout = await addSchedule(routeId, {
      busLayoutId: empty.id,
      departureTime: "11:00",
    });
    const r = await search(date);
    expect(
      r.items.map((i) => [i.scheduleId, i.totalSeats, i.vehicleType, i.vehicleTypeLabel]),
    ).toEqual([[sized, 16, "minivan", "Minivan 16"]]);
    expect(await tripRows(bare)).toHaveLength(0);
    expect(await tripRows(emptyLayout)).toHaveLength(0);
  });

  it("does not refill a sold-out trip's schedule", async () => {
    const date = vnDay(3);
    const { scheduleId, tripId } = await lane(date);
    await (
      await getDb()
    )
      .update(tripSessions)
      .set({ availableSeats: 0, status: "cancelled" })
      .where(eq(tripSessions.id, tripId!));
    expect((await search(date)).total).toBe(0);
    expect(await tripRows(scheduleId)).toHaveLength(1);
  });

  it("warms the whole sell window once, honouring masks, and prunes the seats of departed trips", async () => {
    const { scheduleId, layout } = await lane(null);
    const db = await getDb();
    await db.update(schedules).set({ daysOfWeek: "1111100" }).where(eq(schedules.id, scheduleId));
    const first = await warmTrips();
    const weekdays = Array.from({ length: SELL_WINDOW_DAYS }, (_, i) => vnDay(i)).filter((d) => {
      const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
      return dow < 5;
    });
    expect(first.created).toBe(weekdays.length);
    expect((await tripRows(scheduleId)).map((t) => t.departureDate).sort()).toEqual(weekdays);
    expect((await warmTrips()).created).toBe(0);

    // A trip two days gone keeps its sold seats and loses the unsold ones.
    const old = await addTrip(scheduleId, vnDay(-3), { totalSeats: 4, availableSeats: 3 });
    await openTrip(old, layout.seatIds, [], ["booked", "available", "available", "held"]);
    const pruned = await warmTrips();
    expect(pruned.pruned).toBe(2);
    const left = await db.select().from(seatInventory).where(eq(seatInventory.tripSessionId, old));
    expect(left.map((s) => s.status).sort()).toEqual(["booked", "held"]);
    expect((await db.select().from(tripSessions).where(eq(tripSessions.id, old))).length).toBe(1);
  });
});
