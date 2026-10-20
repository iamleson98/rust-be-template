import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import {
  cancelBooking,
  confirmAsSystem,
  createBooking,
  ownedBooking,
  placeCash,
} from "@/lib/services/booking";
import { bookingView, bookingViews, listBookings } from "@/lib/services/booking-out";
import {
  adminBookingExport,
  adminBookingStats,
  adminListBookings,
  adminUpdateBookingStatus,
  type AdminBookingsQuery,
} from "@/lib/services/admin-bookings";
import { localToday } from "@/lib/services/trip-time";
import {
  booking,
  departIn,
  fixture,
  hold,
  holdReq,
  migrate,
  owner,
  rejection,
  seatsNow,
  type Fixture,
} from "../helpers/fixture";

/**
 * Port of `ticket_tests.rs`: a ticket's life end to end — placed by the
 * customer, confirmed by staff after a phone call, completed or cancelled —
 * and what each side sees.
 */

beforeAll(migrate);

async function set(f: Fixture, id: string, status: string): Promise<string> {
  void f;
  const staff = await owner();
  return (await adminUpdateBookingStatus(staff, id, { status, reason: "called the customer" })).item
    .status;
}

const tickets = (status: string): AdminBookingsQuery => ({ status });

describe("staff confirm", () => {
  it("a placed ticket's seats become booked", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await hold(f, user, 2);
    await placeCash(user, held.bookingId);

    const awaiting = await adminListBookings(tickets("awaiting"));
    expect(awaiting.total).toBe(1);
    expect(awaiting.items[0].code).toBe(held.code);

    expect(await set(f, held.bookingId, "confirmed")).toBe("confirmed");
    expect(await seatsNow(f)).toEqual([0, 0, 2, 0]);
    expect((await adminListBookings(tickets("awaiting"))).total).toBe(0);
  });

  it("writes who did it and why to the audit log", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await placeCash(user, held.bookingId);
    await set(f, held.bookingId, "confirmed");
    const db = await getDb();
    const rows = await db.select().from(auditLog);
    const row = rows.find((r) => r.targetId === held.bookingId);
    expect(row?.action).toBe("booking_confirmed");
    expect(row?.metadata).toBe("called the customer");
    expect(row?.actorType).toBe("staff");
  });

  it("does not collect the payment: confirming a ticket leaves a cash payment pending", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await placeCash(user, held.bookingId);
    await set(f, held.bookingId, "confirmed");
    expect((await booking(held.bookingId)).paymentMethod).toBe("cod");
  });
});

describe("final states", () => {
  it("completed and cancelled tickets are final", async () => {
    const f = await fixture(2);
    const user = await owner();
    const done = await hold(f, user, 1);
    await placeCash(user, done.bookingId);
    await set(f, done.bookingId, "confirmed");
    const dropped = await createBooking(user, holdReq(f, [f.seats[1]]));
    await placeCash(user, dropped.bookingId);
    await cancelBooking(user, dropped.bookingId);

    // Completing is final, so not before the trip has left.
    const early = await rejection(set(f, done.bookingId, "completed"));
    expect(early.status).toBe(400);
    await departIn(f, -1);
    expect(await set(f, done.bookingId, "completed")).toBe("completed");

    for (const id of [done.bookingId, dropped.bookingId]) {
      for (const status of ["confirmed", "completed", "cancelled", "pending"]) {
        const err = await rejection(set(f, id, status));
        expect(err.status, status).toBe(409);
      }
    }
  });

  it("staff cancel frees the seats and skipping steps is refused", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await hold(f, user, 2);
    await placeCash(user, held.bookingId);

    const skip = await rejection(set(f, held.bookingId, "completed"));
    expect(skip).toEqual({ status: 400, message: "a pending ticket cannot become completed" });

    expect(await set(f, held.bookingId, "cancelled")).toBe("cancelled");
    expect(await seatsNow(f)).toEqual([2, 0, 0, 2]);
  });

  it("unknown tickets are 404 and unknown target statuses 400", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    expect((await rejection(set(f, crypto.randomUUID(), "confirmed"))).status).toBe(404);
    const err = await rejection(set(f, held.bookingId, "pending"));
    expect(err).toEqual({ status: 400, message: "a pending ticket cannot become pending" });
  });
});

describe("what customers see", () => {
  it("tickets with stops and seat numbers, not unfinished checkouts", async () => {
    const f = await fixture(3);
    const user = await owner();
    const abandoned = await hold(f, user, 1);
    const placed = await createBooking(user, holdReq(f, f.seats.slice(1)));
    await placeCash(user, placed.bookingId);

    const mine = await bookingViews(await listBookings({ userId: user, placed: true }, 50, 0));
    expect(mine).toHaveLength(1); // the unfinished checkout is not a ticket
    const ticket = mine[0];
    expect(ticket.id).not.toBe(abandoned.bookingId);
    expect(ticket.canCancel).toBe(true);
    expect(ticket.pickup?.name).toBe("Bến xe Giáp Bát");
    expect(ticket.dropoff?.name).toBe("Bến xe Trung tâm Đà Nẵng");
    expect(ticket.seats.map((s) => s.seatCode)).toEqual(["B1", "C1"]);
    expect(ticket.trip?.departureAt).toBeTruthy();

    // The detail by code is the same ticket, and only its owner may read it.
    const byCode = await bookingView(await ownedBooking(user, ticket.code.toLowerCase()));
    expect(byCode.id).toBe(ticket.id);
    expect(ticket.ticketQr, "lists carry no QR").toBeUndefined();
    expect(byCode.ticketQr?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const err = await rejection(ownedBooking(await owner(), ticket.code));
    expect(err.status).toBe(403);
  });

  it("cancelled and completed tickets stay in the history; the departure is Vietnam time", async () => {
    const f = await fixture(2);
    const user = await owner();
    const held = await hold(f, user, 1);
    await placeCash(user, held.bookingId);
    await cancelBooking(user, held.bookingId);
    const rest = await createBooking(user, holdReq(f, [f.seats[1]]));
    await confirmAsSystem(rest.bookingId, "vnpay");
    const list = await bookingViews(await listBookings({ userId: user, placed: true }, 50, 0));
    expect(list.map((b) => b.status).sort()).toEqual(["cancelled", "confirmed"]);
    const open = list.find((b) => b.status === "confirmed")!;
    // 08:30 Vietnam = 01:30 UTC on the trip date.
    expect(open.trip?.departureAt).toBe(`${open.trip?.departureDate}T01:30:00Z`);
  });
});

describe("what staff see", () => {
  it("filter and report tickets, not unfinished checkouts", async () => {
    const f = await fixture(3);
    const user = await owner();
    const confirmed = await hold(f, user, 1);
    await placeCash(user, confirmed.bookingId);
    await set(f, confirmed.bookingId, "confirmed");
    const dropped = await createBooking(user, holdReq(f, [f.seats[1]]));
    await placeCash(user, dropped.bookingId);
    await cancelBooking(user, dropped.bookingId);
    await createBooking(user, holdReq(f, [f.seats[2]]));

    const count = async (q: AdminBookingsQuery) => (await adminListBookings(q)).total;
    expect(await count(tickets("all")), "an unfinished checkout is not a ticket").toBe(2);

    // Brand and route reach the bookings through their trips.
    expect(await count({ brandId: f.brandId })).toBe(2);
    expect(await count({ routeId: f.routeId })).toBe(2);
    expect(await count({ brandId: crypto.randomUUID() })).toBe(0);
    expect(await count({ routeId: crypto.randomUUID() })).toBe(0);

    // Dates are the Vietnamese days the tickets were booked on.
    const today = localToday();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(await count({ dateFrom: today, dateTo: today })).toBe(2);
    expect(await count({ dateFrom: yesterday, dateTo: yesterday })).toBe(0);
    const bad = await rejection(count({ dateFrom: "09/10/2026", dateTo: today }));
    expect(bad.status).toBe(400);

    const cheapest = (await adminListBookings({ sort: "total_asc" })).items;
    expect(cheapest[0].total).toBeLessThanOrEqual(cheapest[1].total);

    // Revenue is what the confirmed ticket brings; the cancelled one counts
    // as a ticket but not as money.
    const stats = await adminBookingStats(tickets("all"));
    const t = stats.totals;
    expect([t.total, t.confirmed, t.cancelled, t.pending]).toEqual([2, 1, 1, 0]);
    expect(t.revenue).toBe((await booking(confirmed.bookingId)).total);
    expect(stats.byDay).toHaveLength(1);
    expect(stats.byDay[0].date).toBe(today);
    expect(stats.byDay[0].revenue).toBe(t.revenue);
  });

  it("search matches code, name and phone; awaiting means pay-on-board waiting for the call", async () => {
    const f = await fixture(2);
    const user = await owner();
    const a = await hold(f, user, 1);
    await placeCash(user, a.bookingId);
    expect((await adminListBookings({ search: a.code.toLowerCase() })).total).toBe(1);
    expect((await adminListBookings({ search: "0912345678" })).total).toBe(1);
    expect((await adminListBookings({ search: "Nguyễn" })).total).toBe(1);
    expect((await adminListBookings({ search: "nobody" })).total).toBe(0);
    expect((await adminListBookings(tickets("awaiting"))).total).toBe(1);
    await confirmAsSystem(a.bookingId, "vnpay");
    expect((await adminListBookings(tickets("awaiting"))).total).toBe(0);
  });

  it("exports the seven CSV columns with a BOM and quoted values", async () => {
    const f = await fixture(1);
    const user = await owner();
    const a = await hold(f, user, 1);
    await placeCash(user, a.bookingId);
    const out = await adminBookingExport({});
    expect(out.count).toBe(1);
    expect(out.columns).toEqual([
      "code",
      "status",
      "contactName",
      "contactPhone",
      "total",
      "paymentMethod",
      "createdAt",
    ]);
    expect(
      out.csv.startsWith("﻿code,status,contactName,contactPhone,total,paymentMethod,createdAt\n"),
    ).toBe(true);
    expect(out.csv).toContain(
      `"${a.code}","pending","Nguyễn Văn A","0912345678","${a.total}","cod",`,
    );
    expect(out.filename).toMatch(/^bookings_export_\d{8}_\d{6}\.csv$/);
  });
});
