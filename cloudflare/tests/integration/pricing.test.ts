import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookingSeats,
  brands,
  pickupPoints,
  scheduleFares,
  schedules,
  seatInventory,
  seats,
} from "@/lib/db/schema";
import { createBooking, ownedBooking, type HoldRequest } from "@/lib/services/booking";
import { bookingView } from "@/lib/services/booking-out";
import { repriceUpcoming } from "@/lib/services/fares";
import {
  STANDARD_FARE,
  booking,
  fixture,
  hold,
  holdReq,
  migrate,
  owner,
  rejection,
  seatsNow,
  ticketsOf,
  type Fixture,
} from "../helpers/fixture";

/**
 * Port of `pricing_tests.rs`: seat prices end to end — class fares, brand
 * child tickets, seat assignment and boarding points, on a real database.
 */

const VIP = 500_000;

beforeAll(migrate);

/** Make the first seat VIP at VIP and re-price the trip. */
async function vipFirstSeat(f: Fixture): Promise<void> {
  const db = await getDb();
  await db.update(seats).set({ seatClass: "vip" }).where(eq(seats.id, f.seats[0]));
  await db.insert(scheduleFares).values({
    id: crypto.randomUUID(),
    scheduleId: f.scheduleId,
    seatClass: "vip",
    priceAdult: VIP,
  });
  await repriceUpcoming(f.scheduleId);
}

async function childTickets(f: Fixture, maxAge: number, discountAmount: number): Promise<void> {
  const db = await getDb();
  await db
    .update(brands)
    .set({ childMaxAge: maxAge, childDiscountAmount: discountAmount })
    .where(eq(brands.id, f.brandId));
}

async function priceOf(f: Fixture, seatId: string): Promise<number> {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(seatInventory)
      .where(and(eq(seatInventory.tripSessionId, f.trip), eq(seatInventory.seatId, seatId)))
  )[0];
  return row.finalPrice;
}

const passenger = (age: number, seatId: string | undefined, claimed: string) => ({
  name: "Trần Thị B",
  type: claimed,
  age,
  seatId,
});

const twoPassengers = (f: Fixture, passengers: HoldRequest["passengers"]): HoldRequest => ({
  ...holdReq(f, f.seats.slice(0, 2)),
  passengers,
});

describe("seat prices", () => {
  it("class fares re-price unsold seats only", async () => {
    const f = await fixture(3);
    const user = await owner();
    // Seat 2 is held before the fare changes and keeps its price.
    const held = await createBooking(user, holdReq(f, [f.seats[1]]));
    await vipFirstSeat(f);
    const db = await getDb();
    await db.update(seats).set({ seatClass: "vip" }).where(eq(seats.id, f.seats[1]));
    await repriceUpcoming(f.scheduleId);

    expect(await priceOf(f, f.seats[0])).toBe(VIP);
    expect(await priceOf(f, f.seats[1])).toBe(STANDARD_FARE);
    expect(await priceOf(f, f.seats[2])).toBe(STANDARD_FARE);
    expect(held.total).toBe(STANDARD_FARE);
  });

  it("each passenger pays for their own seat and age", async () => {
    const f = await fixture(2);
    await vipFirstSeat(f);
    await childTickets(f, 10, 125_000);
    const user = await owner();

    // The child sits in the VIP seat although listed second; the claimed
    // passenger types are wrong on purpose and must be ignored.
    const held = await createBooking(
      user,
      twoPassengers(f, [passenger(35, f.seats[1], "child"), passenger(7, f.seats[0], "adult")]),
    );

    // VIP 500,000 less 125,000 = 375,000 for the child; 350,000 for the adult.
    expect(held.subtotal).toBe(375_000 + STANDARD_FARE);
    const b = await booking(held.bookingId);
    expect([b.adultCount, b.childCount]).toEqual([1, 1]);
    const tickets = (await ticketsOf(held.bookingId)).sort((x, y) => x.price - y.price);
    expect(tickets[0].seatId).toBe(f.seats[1]);
    expect(tickets[0].passengerType).toBe("adult");
    expect(tickets[1].seatId).toBe(f.seats[0]);
    expect(tickets[1].passengerType).toBe("child");
    expect(tickets[1].price).toBe(375_000);
  });

  it("a schedule's child price beats the brand discount but never the adult price", async () => {
    const f = await fixture(1);
    await childTickets(f, 10, 125_000);
    const db = await getDb();
    await db
      .update(schedules)
      .set({ basePriceChild: 200_000 })
      .where(eq(schedules.id, f.scheduleId));
    const held = await createBooking(await owner(), {
      ...holdReq(f),
      passengers: [{ name: "Bé", age: 5 }],
    });
    expect(held.total).toBe(200_000);
  });

  it("without a child policy children pay the adult fare", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await createBooking(
      user,
      twoPassengers(f, [passenger(4, undefined, "child"), passenger(40, undefined, "adult")]),
    );
    expect(held.subtotal).toBe(2 * STANDARD_FARE);
    expect((await booking(held.bookingId)).childCount).toBe(0);
  });

  it("a passenger without an age pays the adult price", async () => {
    const f = await fixture(1);
    await childTickets(f, 10, 125_000);
    const held = await createBooking(await owner(), {
      ...holdReq(f),
      passengers: [{ name: "Không tuổi", type: "child" }],
    });
    expect(held.total).toBe(STANDARD_FARE);
  });

  it("a passenger cannot take a seat twice or one outside the hold", async () => {
    const f = await fixture(3);
    const user = await owner();
    for (const named of [
      [f.seats[0], f.seats[0]],
      [f.seats[0], f.seats[2]],
    ]) {
      const err = await rejection(
        createBooking(
          user,
          twoPassengers(
            f,
            named.map((s) => passenger(30, s, "adult")),
          ),
        ),
      );
      expect(err.status).toBe(400);
    }
    expect((await seatsNow(f))[0]).toBe(3); // nothing was held
  });

  it("a hold that lists a seat twice is refused", async () => {
    const f = await fixture(2);
    const err = await rejection(
      createBooking(await owner(), {
        ...holdReq(f),
        seatIds: [f.seats[0], f.seats[0]],
        passengers: [passenger(30, undefined, "adult"), passenger(30, undefined, "adult")],
      }),
    );
    expect(err.status).toBe(400);
    expect((await seatsNow(f))[0]).toBe(2);
  });
});

describe("boarding points", () => {
  it("must be stops of the route", async () => {
    const f = await fixture(1);
    const user = await owner();
    const elsewhere = { ...holdReq(f), boardingPointId: crypto.randomUUID() };
    const missing = { ...holdReq(f), droppingPointId: null };
    const backwards = { ...holdReq(f), boardingPointId: f.stops[1], droppingPointId: f.stops[0] };
    for (const req of [elsewhere, missing, backwards]) {
      const err = await rejection(createBooking(user, req));
      expect(err.status).toBe(400);
    }
  });

  it("a route without pickup points books without them", async () => {
    const f = await fixture(1);
    const db = await getDb();
    await db.delete(pickupPoints).where(eq(pickupPoints.routeId, f.routeId));
    const user = await owner();
    const held = await createBooking(user, {
      ...holdReq(f),
      boardingPointId: null,
      droppingPointId: null,
    });
    expect(held.total).toBe(STANDARD_FARE);
    // The ticket names the route's cities instead.
    const ticket = await bookingView(await ownedBooking(user, held.code));
    expect(ticket.pickup?.name).toBe("Hà Nội");
    expect(ticket.dropoff?.name).toBe("Đà Nẵng");
    // And asking for a stop the trip does not list is refused.
    const err = await rejection(
      createBooking(user, { ...holdReq(f), boardingPointId: crypto.randomUUID() }),
    );
    expect(err.status).toBe(400);
  });

  it("a ticket keeps the stops it was sold with", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const db = await getDb();
    await db.update(pickupPoints).set({ name: "Renamed" }).where(eq(pickupPoints.id, f.stops[0]));
    const ticket = await bookingView(await ownedBooking(user, held.bookingId));
    expect(ticket.pickup?.name).toBe("Bến xe Giáp Bát");
  });
});

describe("booking seats", () => {
  it("stores a line item per passenger with the price paid", async () => {
    const f = await fixture(2);
    const held = await hold(f, await owner(), 2);
    const db = await getDb();
    const rows = await db
      .select()
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, held.bookingId));
    expect(rows.map((r) => r.price)).toEqual([STANDARD_FARE, STANDARD_FARE]);
    expect(held.seats.map((s) => s.seatClass)).toEqual(["standard", "standard"]);
  });
});
