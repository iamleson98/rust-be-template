import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { seatInventory, tripSessions, bookings } from "@/lib/db/schema";
import {
  ADVANCE_HOLD_SECS,
  HOLD_SECS,
  SELL_WINDOW_DAYS,
  cancelBooking,
  confirmAsSystem,
  createBooking,
  findBooking,
  holdForPayment,
  holdSecsFor,
  placeCash,
  sweepExpiredHolds,
} from "@/lib/services/booking";
import {
  ageHold,
  booking,
  departIn,
  fixture,
  hold,
  holdReq,
  migrate,
  owner,
  payment,
  paymentStatus,
  rejection,
  seatsNow,
  ticketsOf,
} from "../helpers/fixture";
import { brandPrefix, genBookingCode } from "@/lib/format";
import { fmtVnd } from "@/lib/format";
import { toBase36 } from "@/lib/services/booking";

/**
 * Port of the `booking_service.rs` unit tests: the hold state machine, the
 * lifecycle (confirm / place / cancel / expiry) and the pure helpers.
 */

beforeAll(migrate);

const vnDaysOut = (n: number) =>
  new Date(Date.now() + 7 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

describe("pure helpers", () => {
  it("brand prefix is the first letter of each slug segment", () => {
    expect(brandPrefix("phuong-trang")).toBe("PT");
    expect(brandPrefix("vietanh")).toBe("V");
    expect(brandPrefix("")).toBe("BK");
  });

  it("booking codes are PREFIX- plus six unambiguous characters", () => {
    const c = genBookingCode("PT");
    expect(c).toMatch(/^PT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("formats VND with thousand separators and base36", () => {
    expect(fmtVnd(999)).toBe("999");
    expect(fmtVnd(1000)).toBe("1.000");
    expect(fmtVnd(1_500_000)).toBe("1.500.000");
    expect(toBase36(0)).toBe("0");
    expect(toBase36(10)).toBe("a");
    expect(toBase36(36)).toBe("10");
  });
});

describe("hold TTL and booking window", () => {
  it("tiers the hold by booking horizon", () => {
    // Rushed purchases: today and the next two days.
    expect(holdSecsFor(vnDaysOut(0))).toBe(HOLD_SECS);
    expect(holdSecsFor(vnDaysOut(2))).toBe(HOLD_SECS);
    // Advance bookings: three days out and further.
    expect(holdSecsFor(vnDaysOut(3))).toBe(ADVANCE_HOLD_SECS);
    expect(holdSecsFor(vnDaysOut(14))).toBe(ADVANCE_HOLD_SECS);
    expect(ADVANCE_HOLD_SECS).toBeGreaterThan(HOLD_SECS);
    // Malformed dates fall back to the base TTL.
    expect(holdSecsFor("not-a-date")).toBe(HOLD_SECS);
    expect(holdSecsFor("")).toBe(HOLD_SECS);
  });

  it("rejects trips beyond the sell window", async () => {
    const f = await fixture(2);
    const db = await getDb();
    await db
      .update(tripSessions)
      .set({ departureDate: vnDaysOut(SELL_WINDOW_DAYS + 1) })
      .where(eq(tripSessions.id, f.trip));
    const err = await rejection(createBooking(await owner(), holdReq(f)));
    expect(err.status).toBe(400);
    expect(err.message).toContain("bookings open");
  });

  it("gives an advance hold the longer TTL", async () => {
    const f = await fixture(2);
    const db = await getDb();
    await db
      .update(tripSessions)
      .set({ departureDate: vnDaysOut(5) })
      .where(eq(tripSessions.id, f.trip));
    const held = await createBooking(await owner(), holdReq(f));
    const expires = new Date(held.expiresAt).getTime();
    expect(expires).toBeGreaterThan(Date.now() + (ADVANCE_HOLD_SECS - 60) * 1000);
    expect(expires).toBeLessThan(Date.now() + (ADVANCE_HOLD_SECS + 60) * 1000);
  });

  it("gives a same-week hold the base TTL", async () => {
    const f = await fixture(1);
    const held = await hold(f, await owner(), 1);
    const expires = new Date(held.expiresAt).getTime();
    expect(expires).toBeGreaterThan(Date.now() + (HOLD_SECS - 60) * 1000);
    expect(expires).toBeLessThan(Date.now() + (HOLD_SECS + 60) * 1000);
  });
});

describe("hold", () => {
  it("a conflicted multi-seat hold leaves no orphan rows and releases partial claims", async () => {
    const f = await fixture(3);
    const [a, b, c] = f.seats;
    const user = await owner();

    // 1) A clean two-seat hold writes exactly one booking with two line items.
    const first = await createBooking(user, holdReq(f, [a, b]));
    expect(await seatsNow(f)).toEqual([1, 2, 0, 1]); // 3 - 2 held
    expect(await ticketsOf(first.bookingId)).toHaveLength(2);

    // 2) The SAME seats again → 409 and no orphan rows.
    const dup = await rejection(createBooking(user, holdReq(f, [a, b])));
    expect(dup.status).toBe(409);
    const db = await getDb();
    expect(await db.select().from(bookings)).toHaveLength(1);

    // 3) Partial claim [a (held), c (free)] must not leave c held.
    const mixed = await rejection(createBooking(user, holdReq(f, [a, c])));
    expect(mixed.status).toBe(409);
    const cRow = (await db.select().from(seatInventory).where(eq(seatInventory.seatId, c)))[0];
    expect(cRow.status).toBe("available");
    expect(cRow.heldByBookingId).toBeNull();
    expect(await db.select().from(bookings)).toHaveLength(1);
    expect(await seatsNow(f)).toEqual([1, 2, 0, 1]);

    // 4) The response of step 1 is consistent.
    expect(first.seats).toHaveLength(2);
    expect(first.status).toBe("pending");
  });

  it("answers 400 for missing fields, mismatched passengers and a cancelled trip", async () => {
    const f = await fixture(2);
    const user = await owner();
    const noName = await rejection(createBooking(user, { ...holdReq(f), contactName: "   " }));
    expect(noName.status).toBe(400);
    expect(noName.message).toBe("missing required fields");
    const mismatch = await rejection(
      createBooking(user, { ...holdReq(f, f.seats), passengers: [{ name: "A", age: 30 }] }),
    );
    expect(mismatch.message).toBe("passenger count must match seat count");
    const db = await getDb();
    await db.update(tripSessions).set({ status: "cancelled" }).where(eq(tripSessions.id, f.trip));
    const cancelled = await rejection(createBooking(user, holdReq(f)));
    expect(cancelled).toEqual({ status: 400, message: "trip is cancelled" });
    expect(
      await rejection(createBooking(user, { ...holdReq(f), tripId: crypto.randomUUID() })),
    ).toEqual({
      status: 404,
      message: "trip not found",
    });
  });

  it("validates the request like the DTO", async () => {
    const f = await fixture(1);
    const user = await owner();
    for (const bad of [
      { contactPhone: "12345" },
      { contactPhone: "" },
      { contactEmail: "not-an-email" },
      { passengers: [{ name: "", age: 30 }] },
      { passengers: [{ name: "A", age: 151 }] },
    ]) {
      const err = await rejection(createBooking(user, { ...holdReq(f), ...bad }));
      expect(err.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await seatsNow(f)).toEqual([1, 0, 0, 1]);
  });

  it("cannot book a trip that has left", async () => {
    const f = await fixture(1);
    await departIn(f, -2);
    const err = await rejection(createBooking(await owner(), holdReq(f)));
    expect(err).toEqual({ status: 400, message: "trip has already departed" });
    expect(await seatsNow(f)).toEqual([1, 0, 0, 1]);
  });

  it("reads the schedule time as Vietnam time, not UTC", async () => {
    const f = await fixture(1);
    // Departing 3 h from now is still in the future whatever the zone, but a
    // departure 3 h ago in VN time (= 10 h ago if read as UTC+7→UTC) must be refused.
    await departIn(f, -3);
    expect((await rejection(createBooking(await owner(), holdReq(f)))).status).toBe(400);
    await departIn(f, 3);
    await createBooking(await owner(), holdReq(f));
  });

  it("copies the stops onto the booking and falls back to the route's cities", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await hold(f, user, 1);
    const row = await booking(held.bookingId);
    expect(row.pickupName).toBe("Bến xe Giáp Bát");
    expect(row.dropoffName).toBe("Bến xe Trung tâm Đà Nẵng");
    expect(row.boardingPointId).toBe(f.stops[0]);
  });
});

describe("lifecycle: confirm / place / cancel / expiry", () => {
  it("confirming books the seats and repeats harmlessly", async () => {
    const f = await fixture(3);
    const user = await owner();
    const held = await hold(f, user, 2);
    expect(await seatsNow(f)).toEqual([1, 2, 0, 1]);

    await confirmAsSystem(held.bookingId, "vnpay");
    const b = await booking(held.bookingId);
    expect(b.status).toBe("confirmed");
    expect(b.paymentMethod).toBe("vnpay");
    expect(await seatsNow(f)).toEqual([1, 0, 2, 1]);
    const db = await getDb();
    const rows = await db
      .select()
      .from(seatInventory)
      .where(eq(seatInventory.heldByBookingId, held.bookingId));
    expect(rows.every((r) => r.heldUntil === null)).toBe(true);

    // A repeated gateway notification is not an error and changes nothing.
    const again = await confirmAsSystem(held.bookingId, "vnpay");
    expect(again.status).toBe("confirmed");
    expect(await seatsNow(f)).toEqual([1, 0, 2, 1]);
  });

  it("paying on board places the booking for the operator to confirm", async () => {
    const f = await fixture(2);
    const [user, stranger] = [await owner(), await owner()];
    const held = await hold(f, user, 1);

    const foreign = await rejection(placeCash(stranger, held.bookingId));
    expect(foreign.status).toBe(403);

    const placed = await placeCash(user, held.bookingId);
    expect([placed.status, placed.paymentMethod]).toEqual(["pending", "cod"]);
    // Still the customer's seat, held until the trip leaves (tomorrow), well
    // past the checkout hold; the sweep leaves it alone.
    const b = await booking(held.bookingId);
    expect(b.paymentMethod).toBe("cod");
    expect(new Date(b.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 6 * 3_600_000);
    await sweepExpiredHolds();
    expect(await seatsNow(f)).toEqual([1, 1, 0, 1]);
  });

  it("cancelling frees the seats, the counter and pending payments", async () => {
    const f = await fixture(3);
    const user = await owner();
    const held = await hold(f, user, 2);
    const pay = await payment(held, user, "pending");
    expect(await seatsNow(f)).toEqual([1, 2, 0, 1]);

    await cancelBooking(user, held.bookingId, "changed my mind");

    expect((await booking(held.bookingId)).status).toBe("cancelled");
    expect(await seatsNow(f)).toEqual([3, 0, 0, 3]);
    expect(await paymentStatus(pay)).toBe("cancelled");

    const again = await rejection(cancelBooking(user, held.bookingId));
    expect(again).toEqual({ status: 400, message: "booking already cancelled" });
    expect(await seatsNow(f)).toEqual([3, 0, 0, 3]); // no double release
  });

  it("cancelling a confirmed booking releases booked seats too", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await hold(f, user, 2);
    await confirmAsSystem(held.bookingId, "vnpay");
    expect(await seatsNow(f)).toEqual([0, 0, 2, 0]);
    await cancelBooking(user, held.bookingId);
    expect(await seatsNow(f)).toEqual([2, 0, 0, 2]);
  });

  it("a trip that has left cannot be cancelled", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await placeCash(user, held.bookingId);
    await departIn(f, -1);
    const err = await rejection(cancelBooking(user, held.bookingId));
    expect(err).toEqual({ status: 400, message: "the trip has already left" });
    expect((await booking(held.bookingId)).status).toBe("pending");
  });

  it("only the owner may cancel", async () => {
    const f = await fixture(1);
    const [user, stranger] = [await owner(), await owner()];
    const held = await hold(f, user, 1);
    const err = await rejection(cancelBooking(stranger, held.bookingId));
    expect(err.status).toBe(403);
    expect((await booking(held.bookingId)).status).toBe("pending");
    expect((await rejection(cancelBooking(user, crypto.randomUUID()))).status).toBe(404);
  });

  it("a completed booking cannot be cancelled by the customer", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const db = await getDb();
    await db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, held.bookingId));
    const err = await rejection(cancelBooking(user, held.bookingId));
    expect(err).toEqual({ status: 400, message: "a completed booking cannot be cancelled" });
  });

  it("refund follows the real departure and what was paid", async () => {
    for (const [hours, percent] of [
      [72, 90],
      [10, 50],
      [2, 0],
    ] as const) {
      const f = await fixture(1);
      const user = await owner();
      const held = await hold(f, user, 1);
      await payment(held, user, "completed");
      await confirmAsSystem(held.bookingId, "vnpay");
      await departIn(f, hours);
      const r = await cancelBooking(user, held.bookingId);
      expect(r.refundPercent, `${hours} h before departure`).toBe(percent);
      expect(r.refundAmount, `${hours} h`).toBe(Math.floor((held.total * percent) / 100));
    }
  });

  it("an unpaid booking refunds nothing", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await departIn(f, 72);
    const r = await cancelBooking(user, held.bookingId);
    expect([r.refundPercent, r.refundAmount]).toEqual([0, 0]);
    expect(r.refCode).toMatch(/^HX-[A-Z0-9-]+-[0-9A-Z]+$/);
  });

  it("the sweep releases expired holds and nothing else", async () => {
    const f = await fixture(4);
    const user = await owner();
    const stale = await hold(f, user, 2);
    const pay = await payment(stale, user, "pending");
    const fresh = await createBooking(user, holdReq(f, [f.seats[2]]));
    const paid = await createBooking(user, holdReq(f, [f.seats[3]]));
    await confirmAsSystem(paid.bookingId, "vnpay");
    await ageHold(stale.bookingId, 30);
    await ageHold(paid.bookingId, 30); // confirmed bookings no longer expire
    expect(await seatsNow(f)).toEqual([0, 3, 1, 0]);

    const done = await sweepExpiredHolds();

    expect(done).toEqual({ cancelled: 1, seats: 2 });
    expect((await booking(stale.bookingId)).status).toBe("cancelled");
    expect((await booking(fresh.bookingId)).status).toBe("pending");
    expect((await booking(paid.bookingId)).status).toBe("confirmed");
    expect(await seatsNow(f)).toEqual([2, 1, 1, 2]);
    expect(await paymentStatus(pay)).toBe("cancelled");

    expect(await sweepExpiredHolds()).toEqual({ cancelled: 0, seats: 0 });
  });

  it("expired seats can be sold again", async () => {
    const f = await fixture(1);
    const [first, second] = [await owner(), await owner()];
    const abandoned = await hold(f, first, 1);
    const err = await rejection(createBooking(second, holdReq(f, f.seats)));
    expect(err.status).toBe(409);

    await ageHold(abandoned.bookingId, 5);
    await sweepExpiredHolds();
    await createBooking(second, holdReq(f, f.seats));
  });

  it("placing after the deadline gets 410 and the seats back", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await hold(f, user, 2);
    await ageHold(held.bookingId, 5);

    const err = await rejection(placeCash(user, held.bookingId));
    expect(err).toEqual({ status: 410, message: "booking hold has expired" });
    expect((await booking(held.bookingId)).status).toBe("cancelled");
    expect(await seatsNow(f)).toEqual([2, 0, 0, 2]);
  });

  it("a payment that lands late still confirms until the sweep runs", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await ageHold(held.bookingId, 5);
    await confirmAsSystem(held.bookingId, "vnpay");
    expect((await booking(held.bookingId)).status).toBe("confirmed");
    expect(await sweepExpiredHolds()).toEqual({ cancelled: 0, seats: 0 });

    // Once the sweep has taken the seats back, the money cannot buy them.
    const g = await fixture(1);
    const user2 = await owner();
    const held2 = await hold(g, user2, 1);
    await ageHold(held2.bookingId, 5);
    await sweepExpiredHolds();
    const err = await rejection(confirmAsSystem(held2.bookingId, "vnpay"));
    expect(err.status).toBe(409);
  });

  it("confirming a booking whose seats were lost answers 410, an unknown one 404", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const db = await getDb();
    // Seats taken away while the booking is still pending (data fix gone wrong).
    await db
      .update(seatInventory)
      .set({ status: "available", heldByBookingId: null })
      .where(eq(seatInventory.heldByBookingId, held.bookingId));
    expect((await rejection(confirmAsSystem(held.bookingId, "cod"))).status).toBe(410);
    expect((await booking(held.bookingId)).status).toBe("pending");
    expect((await rejection(confirmAsSystem(crypto.randomUUID(), "cod"))).status).toBe(404);
  });

  it("starting a payment keeps the seats for it", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const before = (await booking(held.bookingId)).expiresAt!;

    expect(await holdForPayment(held.bookingId, "vnpay")).toBe(true);
    const b = await booking(held.bookingId);
    expect(b.expiresAt! > before).toBe(true);
    expect(b.paymentMethod).toBe("vnpay");
    const db = await getDb();
    const seat = (
      await db.select().from(seatInventory).where(eq(seatInventory.heldByBookingId, held.bookingId))
    )[0];
    expect(seat.heldUntil).toBe(b.expiresAt);

    await cancelBooking(user, held.bookingId);
    expect(await holdForPayment(held.bookingId, "vnpay")).toBe(false);
  });

  it("finds a booking by id or by code in any case", async () => {
    const f = await fixture(1);
    const held = await hold(f, await owner(), 1);
    expect((await findBooking(held.bookingId))?.id).toBe(held.bookingId);
    expect((await findBooking(` ${held.code.toLowerCase()} `))?.id).toBe(held.bookingId);
    expect(await findBooking("NOPE-000000")).toBeNull();
  });
});

describe("hold from a link creates the seats", () => {
  it("fills a trip that has no seat rows yet, priced per class", async () => {
    const f = await fixture(2);
    const db = await getDb();
    await db.delete(seatInventory).where(eq(seatInventory.tripSessionId, f.trip));
    const held = await hold(f, await owner(), 1);
    expect(held.total).toBe(350_000);
    expect(
      (await db.select().from(seatInventory).where(eq(seatInventory.tripSessionId, f.trip))).length,
    ).toBe(2);
  });
});
