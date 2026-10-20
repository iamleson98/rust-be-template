/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted structurally */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/auth/jwt";
import { setCloudflareContext } from "../helpers/context";
import { booking, fixture, hold, holdReq, migrate, owner, type Fixture } from "../helpers/fixture";
import { POST as holdRoute, GET as listRoute } from "../../src/app/api/bookings/route";
import { POST as holdAlias } from "../../src/app/api/bookings/hold/route";
import { GET as detailRoute } from "../../src/app/api/bookings/[idOrCode]/route";
import { POST as cancelRoute } from "../../src/app/api/bookings/[idOrCode]/cancel/route";
import { POST as placeRoute } from "../../src/app/api/bookings/[idOrCode]/place/route";
import { POST as payRoute } from "../../src/app/api/payments/route";
import { GET as paymentRoute } from "../../src/app/api/payments/[id]/route";
import { GET as providersRoute } from "../../src/app/api/payments/providers/route";
import { GET as adminList } from "../../src/app/api/admin/bookings/route";
import { PATCH as adminPatch } from "../../src/app/api/admin/bookings/[id]/route";
import { GET as adminStats } from "../../src/app/api/admin/bookings/stats/route";
import { GET as adminExport } from "../../src/app/api/admin/bookings/export/route";
import { GET as adminPayments } from "../../src/app/api/admin/payments/route";
import { GET as adminSummary } from "../../src/app/api/admin/payments/summary/route";
import { POST as markCod } from "../../src/app/api/payments/[id]/mark-cod-collected/route";
import { POST as momoIpn } from "../../src/app/api/payments/ipn/momo/route";
import { POST as zaloIpn } from "../../src/app/api/payments/ipn/zalopay/route";

/** The HTTP contract the SPA depends on: statuses, bodies, permissions. */

declare global {
  interface Response {
    json(): Promise<any>;
  }
}

beforeAll(migrate);
beforeEach(() => setCloudflareContext());

async function req(
  userId: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Request> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers.authorization = `Bearer ${await signAccessToken(userId)}`;
  return new Request(`https://datxevui.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const body = (f: Fixture) => ({ ...holdReq(f), couponId: undefined });

describe("customer bookings", () => {
  it("holds seats (200, Rust body shape) and exposes the /hold alias", async () => {
    const f = await fixture(3);
    const user = await owner();
    const res = await holdRoute(await req(user, "POST", "/api/bookings", body(f)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(
      [
        "bookingId",
        "code",
        "expiresAt",
        "fees",
        "discount",
        "seats",
        "status",
        "subtotal",
        "total",
      ].sort(),
    );
    expect(json.seats[0]).toMatchObject({
      seatCode: "A1",
      seatClass: "standard",
      passengerType: "adult",
      price: 350_000,
    });

    const alias = await holdAlias(
      await req(user, "POST", "/api/bookings/hold", { ...body(f), seatIds: [f.seats[1]] }),
    );
    expect(alias.status).toBe(200);
    const conflict = await holdAlias(await req(user, "POST", "/api/bookings/hold", body(f)));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.message).toBe("some seats are no longer available");
    expect((await holdRoute(await req(null, "POST", "/api/bookings", body(f)))).status).toBe(401);
  });

  it("lists placed tickets, shows one by code to its owner only, cancels and places", async () => {
    const f = await fixture(3);
    const user = await owner();
    const a = await hold(f, user, 1);
    const unplaced = await listRoute(await req(user, "GET", "/api/bookings"));
    expect((await unplaced.json()).items).toHaveLength(0);

    const placed = await placeRoute(
      await req(user, "POST", "/x"),
      params({ idOrCode: a.bookingId }),
    );
    expect(await placed.json()).toEqual({
      bookingId: a.bookingId,
      status: "pending",
      paymentMethod: "cod",
    });
    expect(
      (await (await listRoute(await req(user, "GET", "/api/bookings"))).json()).items,
    ).toHaveLength(1);

    const stranger = await owner();
    const foreign = await detailRoute(
      await req(stranger, "GET", "/x"),
      params({ idOrCode: a.code }),
    );
    expect(foreign.status).toBe(403);
    const mine = await detailRoute(
      await req(user, "GET", "/x"),
      params({ idOrCode: a.code.toLowerCase() }),
    );
    expect(mine.status).toBe(200);
    const view = await mine.json();
    expect(view).toMatchObject({
      id: a.bookingId,
      status: "pending",
      paymentMethod: "cod",
      canCancel: true,
    });
    expect(view.ticketQr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(view.review).toBeUndefined();

    const cancel = await cancelRoute(
      await req(user, "POST", "/x", { reason: "plans changed" }),
      params({ idOrCode: a.bookingId }),
    );
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({
      success: true,
      refundPercent: 0,
      refundAmount: 0,
      reason: "plans changed",
    });
    const twice = await cancelRoute(
      await req(user, "POST", "/x", {}),
      params({ idOrCode: a.bookingId }),
    );
    expect(twice.status).toBe(400);
    // Cancelled tickets stay in the history.
    expect(
      (await (await listRoute(await req(user, "GET", "/api/bookings"))).json()).items[0].status,
    ).toBe("cancelled");
  });

  it("answers 410 when the hold ran out", async () => {
    const f = await fixture(1);
    const user = await owner();
    const a = await hold(f, user, 1);
    const { ageHold } = await import("../helpers/fixture");
    await ageHold(a.bookingId, 5);
    const res = await placeRoute(await req(user, "POST", "/x"), params({ idOrCode: a.bookingId }));
    expect(res.status).toBe(410);
  });
});

describe("payments over HTTP", () => {
  it("creates a cash payment (200 { payment }), hides it from strangers and lists providers", async () => {
    const f = await fixture(1);
    const user = await owner();
    const a = await hold(f, user, 1);
    expect(await (await providersRoute()).json()).toEqual({ providers: ["cod"] });

    const anon = await payRoute(
      await req(null, "POST", "/api/payments", { bookingId: a.bookingId, provider: "cod" }),
    );
    expect(anon.status).toBe(401);
    const res = await payRoute(
      await req(user, "POST", "/api/payments", { bookingId: a.bookingId, provider: "cod" }),
    );
    expect(res.status).toBe(200);
    const { payment } = await res.json();
    expect(payment).toMatchObject({
      provider: "cod",
      status: "pending",
      amount: a.total,
      bookingId: a.bookingId,
    });
    expect(payment.returnUrl).toContain(`/payments/${payment.id}/return`);

    const stranger = await owner();
    expect(
      (await paymentRoute(await req(stranger, "GET", "/x"), params({ id: payment.id }))).status,
    ).toBe(403);
    expect(
      (await paymentRoute(await req(user, "GET", "/x"), params({ id: payment.id }))).status,
    ).toBe(200);
    const bad = await payRoute(
      await req(user, "POST", "/api/payments", { bookingId: a.bookingId, provider: "x" }),
    );
    expect(bad.status).toBe(400);
  });

  it("answers MoMo and ZaloPay webhooks with their own codes at HTTP 200", async () => {
    setCloudflareContext({
      MOMO_SECRET_KEY: "sk",
      MOMO_ACCESS_KEY: "ak",
      ZALOPAY_KEY2: "k2",
      ZALOPAY_APP_ID: "1",
    });
    const post = (path: string, payload: string) =>
      new Request(`https://datxevui.com${path}`, { method: "POST", body: payload });
    const bad = await momoIpn(
      post(
        "/api/payments/ipn/momo",
        JSON.stringify({ orderId: "o", amount: 1, transId: 1, resultCode: 0, signature: "x" }),
      ),
    );
    expect([bad.status, await bad.json()]).toEqual([
      200,
      { code: 2, message: "Invalid Signature" },
    ]);
    const notJson = await momoIpn(post("/api/payments/ipn/momo", "nope"));
    expect(notJson.status).toBe(400);
    const missing = await momoIpn(post("/api/payments/ipn/momo", JSON.stringify({ orderId: "o" })));
    expect(missing.status).toBe(422);
    const mac = await zaloIpn(
      post("/api/payments/ipn/zalopay", JSON.stringify({ data: "{}", mac: "x" })),
    );
    expect([mac.status, await mac.json()]).toEqual([
      200,
      { return_code: 3, return_message: "Invalid MAC" },
    ]);
    expect((await zaloIpn(post("/api/payments/ipn/zalopay", "nope"))).status).toBe(400);
  });
});

describe("staff", () => {
  it("confirm → collect → complete, with the permissions and shapes the console expects", async () => {
    const f = await fixture(2);
    const user = await owner();
    const staff = await owner("admin");
    const a = await hold(f, user, 1);
    const customerTryingAdmin = await adminList(await req(user, "GET", "/api/admin/bookings"));
    expect(customerTryingAdmin.status).toBe(403);

    // Customer places on board; the console lists it as awaiting.
    const pay = await payRoute(
      await req(user, "POST", "/api/payments", { bookingId: a.bookingId, provider: "cod" }),
    );
    const paymentId = (await pay.json()).payment.id;
    const awaiting = await (
      await adminList(await req(staff, "GET", "/api/admin/bookings?status=awaiting"))
    ).json();
    expect([awaiting.total, awaiting.limit, awaiting.offset]).toEqual([1, 50, 0]);

    const confirm = await adminPatch(
      await req(staff, "PATCH", "/x", { status: "confirmed", reason: "called" }),
      params({ id: a.bookingId }),
    );
    expect(confirm.status).toBe(200);
    expect((await confirm.json()).item).toMatchObject({
      status: "confirmed",
      paymentMethod: "cod",
    });
    const again = await adminPatch(
      await req(staff, "PATCH", "/x", { status: "confirmed" }),
      params({ id: a.bookingId }),
    );
    expect(again.status).toBe(400); // confirmed → confirmed

    // The cash payment is still pending until the driver collects.
    const summary = await (await adminSummary(await req(staff, "GET", "/x"))).json();
    expect(summary).toMatchObject({ total: 1, pending: 1, completed: 0, collected: 0 });
    const collected = await markCod(
      await req(staff, "POST", "/x", { amountCollected: a.total }),
      params({ id: paymentId }),
    );
    expect(await collected.json()).toMatchObject({
      paymentId,
      status: "completed",
      amountCollected: a.total,
    });
    expect(
      (await markCod(await req(user, "POST", "/x", {}), params({ id: paymentId }))).status,
    ).toBe(403);
    expect((await (await adminSummary(await req(staff, "GET", "/x"))).json()).collected).toBe(
      a.total,
    );
    const list = await (await adminPayments(await req(staff, "GET", "/x?status=completed"))).json();
    expect(list.items[0]).toMatchObject({ bookingCode: a.code, status: "completed" });

    const stats = await (await adminStats(await req(staff, "GET", "/x"))).json();
    expect(stats.totals).toMatchObject({ total: 1, confirmed: 1, revenue: a.total });
    const csv = await (await adminExport(await req(staff, "GET", "/x"))).json();
    expect(csv.count).toBe(1);
    expect((await booking(a.bookingId)).status).toBe("confirmed");
  });
});
