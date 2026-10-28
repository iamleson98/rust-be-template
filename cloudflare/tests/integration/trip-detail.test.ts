/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { busLayouts, seatInventory, tripSessions } from "@/lib/db/schema";
import { GET as detailRoute } from "../../src/app/api/trips/[tripId]/route";
import { setCloudflareContext } from "../helpers/context";
import { migrate } from "../helpers/fixture";
import {
  addBrand,
  addFare,
  addLayout,
  addPickupPoints,
  addRoute,
  addSchedule,
  addTimetable,
  addTrip,
  openTrip,
  resetCatalog,
  vnDay,
} from "../helpers/catalog";

/** `GET /api/trips/{id}` (`PublicService::trip_detail`). */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await resetCatalog();
});

const get = (tripId: string) =>
  detailRoute(new Request(`https://datxevui.com/api/trips/${tripId}`), {
    params: Promise.resolve({ tripId }),
  });

async function seeded(over: { layoutData?: string } = {}) {
  const brandId = await addBrand({ childMaxAge: 10, childDiscountAmount: 50_000, rating: 4.5 });
  const layout = await addLayout(
    brandId,
    [
      { label: "A1", row: 1, col: 1 },
      { label: "A2", row: 1, col: 2 },
      { label: "B1", row: 2, col: 1, seatClass: "vip" },
    ],
    over,
  );
  const routeId = await addRoute(brandId);
  const scheduleId = await addSchedule(routeId, {
    busLayoutId: layout.id,
    basePriceAdult: 300_000,
    amenities: '["wifi","sauna"]',
  });
  await addFare(scheduleId, "vip", 500_000);
  const date = vnDay(2);
  const tripId = await addTrip(scheduleId, date, { totalSeats: 3, availableSeats: 3 });
  return { brandId, layout, routeId, scheduleId, tripId, date };
}

describe("trip detail", () => {
  it("answers 404 for an unknown trip and 400 for something that is not an id", async () => {
    const res = await get(crypto.randomUUID());
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("trip not found");
    expect((await get("not-a-uuid")).status).toBe(400);
  });

  it("creates the seats of a trip nobody opened, priced from the fares", async () => {
    const { tripId } = await seeded();
    const db = await getDb();
    expect(
      await db.select().from(seatInventory).where(eq(seatInventory.tripSessionId, tripId)),
    ).toHaveLength(0);
    const body = await (await get(tripId)).json();
    const rows = await db
      .select()
      .from(seatInventory)
      .where(eq(seatInventory.tripSessionId, tripId));
    expect(rows.map((r) => r.finalPrice).sort()).toEqual([300_000, 300_000, 500_000]);
    expect(
      body.seatMap.decks[0].rows.flatMap((r: any) => r.seats.map((s: any) => s.finalPrice)),
    ).toEqual([300_000, 300_000, 500_000]);
    // Opening again creates nothing more.
    await get(tripId);
    expect(
      await db.select().from(seatInventory).where(eq(seatInventory.tripSessionId, tripId)),
    ).toHaveLength(3);
  });

  it("returns the Rust TripDetail shape", async () => {
    const { tripId, routeId, brandId, layout, date } = await seeded();
    const res = await get(tripId);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      [
        "amenities",
        "brand",
        "busLayout",
        "from",
        "pickupPoints",
        "pricing",
        "route",
        "schedulePoints",
        "seatMap",
        "to",
        "trip",
      ].sort(),
    );
    expect(body.trip).toMatchObject({
      id: tripId,
      bookable: true,
      departureDate: date,
      departureAt: `${date}T08:00:00`,
      departureTime: "08:00",
      status: "scheduled",
      totalSeats: 3,
      availableSeats: 3,
    });
    expect(body.route).toMatchObject({ id: routeId });
    expect(body.brand).toMatchObject({ id: brandId, rating: 4.5 });
    expect(body.from).toMatchObject({ name: "Hà Nội", lat: 21.03 });
    expect(body.busLayout).toEqual({
      id: layout.id,
      name: "Layout",
      capacity: 3,
      vehicleType: "standard",
      vehicleTypeLabel: "Ghế ngồi",
    });
    expect(body.amenities).toEqual([
      { key: "wifi", label: "WiFi" },
      { key: "sauna", label: "" },
    ]);
  });

  it("prices per class with the brand's child fares, cheapest class first", async () => {
    const { tripId, layout } = await seeded();
    await get(tripId);
    // A booked standard seat does not count towards "from".
    const db = await getDb();
    await db
      .update(seatInventory)
      .set({ status: "booked" })
      .where(eq(seatInventory.seatId, layout.seatIds[0]!));
    const body = await (await get(tripId)).json();
    expect(body.pricing).toEqual({
      basePriceAdult: 300_000,
      basePriceChild: 250_000,
      childFare: { maxAge: 10, discountAmount: 50_000 },
      fares: [
        { seatClass: "standard", priceAdult: 300_000, priceChild: 250_000, seats: 2, available: 1 },
        { seatClass: "vip", priceAdult: 500_000, priceChild: 450_000, seats: 1, available: 1 },
      ],
    });
    const seats = body.seatMap.decks[0].rows.flatMap((r: any) => r.seats);
    expect(seats.map((s: any) => [s.seatLabel, s.status, s.childPrice])).toEqual([
      ["A1", "booked", 250_000],
      ["A2", "available", 250_000],
      ["B1", "available", 450_000],
    ]);
  });

  it("lists the route's pickup points, else the timetable's stops, and the timetable with times", async () => {
    const { tripId, routeId, brandId, scheduleId } = await seeded();
    await addTimetable(brandId, scheduleId, [
      { name: "Bến A", lat: 21, lon: 105.8, arrival: "08:00" },
      { name: "Bến B", lat: 10.8, lon: 106.7, arrival: "07:30" },
    ]);
    const timetable = await (await get(tripId)).json();
    expect(timetable.pickupPoints.map((p: any) => [p.name, p.stopOrder])).toEqual([
      ["Bến A", 1],
      ["Bến B", 2],
    ]);
    expect(timetable.schedulePoints.map((p: any) => [p.name, p.arrivalTime, p.kind])).toEqual([
      ["Bến A", "08:00", "pickup"],
      ["Bến B", "07:30", "drop"],
    ]);
    // 07:30 is not after the 08:00 departure: it arrives the next day.
    expect(timetable.trip.arrivalAt).toBe(`${vnDay(3)}T07:30:00`);

    await addPickupPoints(routeId, [{ name: "Điểm đón", lat: 21, lon: 105.8 }]);
    const withPoints = await (await get(tripId)).json();
    expect(withPoints.pickupPoints.map((p: any) => p.name)).toEqual(["Điểm đón"]);
  });

  it("reports a departed or cancelled trip as not bookable", async () => {
    const { tripId } = await seeded();
    const db = await getDb();
    await db.update(tripSessions).set({ status: "cancelled" }).where(eq(tripSessions.id, tripId));
    expect((await (await get(tripId)).json()).trip.bookable).toBe(false);
    await db
      .update(tripSessions)
      .set({ status: "scheduled", departureDate: vnDay(-1) })
      .where(eq(tripSessions.id, tripId));
    expect((await (await get(tripId)).json()).trip.bookable).toBe(false);
  });

  it("draws the saved floor plan while it still matches the seats", async () => {
    const plan = {
      version: 2,
      decks: [
        {
          rows: 2,
          cols: 3,
          cells: [
            { row: 1, col: 1, kind: "seat", label: "A1" },
            { row: 1, col: 2, kind: "bed", label: "A2" },
            { row: 2, col: 1, kind: "seat", label: "B1" },
            { row: 2, col: 3, kind: "door" },
          ],
        },
      ],
    };
    const { tripId, layout } = await seeded({ layoutData: JSON.stringify(plan) });
    const body = await (await get(tripId)).json();
    const deck = body.seatMap.decks[0];
    expect(deck.plan).toEqual({ rows: 2, cols: 3, fixtures: [{ row: 2, col: 3, kind: "door" }] });
    expect(deck.rows.flatMap((r: any) => r.seats.map((s: any) => s.kind))).toEqual([
      "seat",
      "bed",
      "seat",
    ]);

    // A plan that drifted from the seat rows is not trusted.
    const db = await getDb();
    await db
      .update(busLayouts)
      .set({ layoutData: JSON.stringify({ ...plan, decks: [{ ...plan.decks[0], cells: [] }] }) })
      .where(eq(busLayouts.id, layout.id));
    const drifted = await (await get(tripId)).json();
    expect(drifted.seatMap.decks[0].plan).toBeUndefined();
    expect(drifted.seatMap.decks[0].rows[0].seats[0].kind).toBeUndefined();
  });

  it("leaves a trip without a layout without a seat map, and its capacity null", async () => {
    const brandId = await addBrand();
    const routeId = await addRoute(brandId);
    const scheduleId = await addSchedule(routeId);
    const tripId = await addTrip(scheduleId, vnDay(2), { totalSeats: 16, availableSeats: 16 });
    const body = await (await get(tripId)).json();
    expect(body.seatMap).toEqual({ decks: [] });
    expect(body.busLayout.capacity).toBeNull();
    expect(body.busLayout.id).toBeUndefined();
  });

  it("shows the live status of held seats", async () => {
    const { tripId, layout } = await seeded();
    await openTrip(
      tripId,
      layout.seatIds,
      [300_000, 300_000, 500_000],
      ["held", "available", "available"],
    );
    const body = await (await get(tripId)).json();
    const seats = body.seatMap.decks[0].rows.flatMap((r: any) => r.seats);
    expect(seats.map((s: any) => s.status)).toEqual(["held", "available", "available"]);
  });
});
