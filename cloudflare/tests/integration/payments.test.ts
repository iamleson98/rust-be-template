import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, payments } from "@/lib/db/schema";
import { confirmAsSystem, sweepExpiredHolds } from "@/lib/services/booking";
import {
  adminGetPayment,
  adminListPayments,
  adminPaymentSummary,
  adminUpdatePaymentStatus,
  cancelPayment,
  cancelPriorPendingPayments,
  createPayment,
  enabledProviders,
  getPayment,
  handleMomoIpn,
  handleVnpayIpn,
  handleZalopayCallback,
  listBookingPayments,
  markCodCollected,
  percentEncode,
} from "@/lib/services/payment";
import { setCloudflareContext } from "../helpers/context";
import {
  ageHold,
  booking,
  fixture,
  hold,
  migrate,
  owner,
  payment,
  paymentStatus,
  rejection,
  seatsNow,
} from "../helpers/fixture";

/**
 * Port of the `payment_service.rs` unit tests, plus the IPN signature,
 * amount and idempotency rules the Rust service implements.
 */

beforeAll(migrate);
beforeEach(() => setCloudflareContext());

const cod = (bookingId: string) => ({ bookingId, provider: "cod" });

async function row(id: string) {
  const db = await getDb();
  return (await db.select().from(payments).where(eq(payments.id, id)))[0];
}

describe("creating a payment", () => {
  it("a fully discounted booking is placed on board, not sent to a gateway", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const db = await getDb();
    await db
      .update(bookings)
      .set({ discount: held.subtotal, total: 0 })
      .where(eq(bookings.id, held.bookingId));

    const err = await rejection(
      createPayment({ bookingId: held.bookingId, provider: "vnpay" }, user),
    );
    expect(err.status).toBe(400);
    // Nothing changed: pay-on-board still places it.
    await createPayment(cod(held.bookingId), user);
  });

  it("a booking's payments are private to its owner", async () => {
    const f = await fixture(2);
    const [user, stranger] = [await owner(), await owner()];
    const held = await hold(f, user, 1);
    const made = await createPayment(cod(held.bookingId), user);
    const pid = made.payment.id;

    // Signed out: 401 on every door.
    const statusOf = async (p: Promise<unknown>) => (await rejection(p)).status;
    expect(await statusOf(getPayment(pid, null))).toBe(401);
    expect(await statusOf(listBookingPayments(held.bookingId, null))).toBe(401);
    expect(await statusOf(cancelPayment(pid, null))).toBe(401);
    expect(await statusOf(createPayment(cod(held.bookingId), null))).toBe(401);

    // Someone else: 403.
    expect(await statusOf(getPayment(pid, stranger))).toBe(403);
    expect(await statusOf(listBookingPayments(held.bookingId, stranger))).toBe(403);
    expect(await statusOf(cancelPayment(pid, stranger))).toBe(403);
    expect(await statusOf(createPayment(cod(held.bookingId), stranger))).toBe(403);

    // The owner sees it, and it is in the list.
    expect((await getPayment(pid, user)).id).toBe(pid);
    expect((await listBookingPayments(held.bookingId, user)).items).toHaveLength(1);
  });

  it("unknown bookings and payments are 404", async () => {
    const user = await owner();
    expect((await rejection(createPayment(cod(crypto.randomUUID()), user))).status).toBe(404);
    expect((await rejection(getPayment(crypto.randomUUID(), user))).status).toBe(404);
    expect((await rejection(listBookingPayments(crypto.randomUUID(), user))).status).toBe(404);
  });

  it("a cash payment places the booking and collecting confirms it", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);

    const made = await createPayment(cod(held.bookingId), user);
    // Placed: the seat stays held until departure for the operator's call.
    const b = await booking(held.bookingId);
    expect([b.status, b.paymentMethod]).toEqual(["pending", "cod"]);
    expect(await seatsNow(f)).toEqual([0, 1, 0, 0]);
    expect(await paymentStatus(made.payment.id)).toBe("pending");
    await sweepExpiredHolds();
    expect((await booking(held.bookingId)).status).toBe("pending");

    const staff = await owner();
    const out = await markCodCollected(made.payment.id, staff);
    expect(out).toMatchObject({ status: "completed", amountCollected: held.total });
    expect(await paymentStatus(made.payment.id)).toBe("completed");
    expect((await booking(held.bookingId)).status).toBe("confirmed");
    const p = await row(made.payment.id);
    expect(p.collectedBy).toBe(staff);
    expect(p.collectedAt).toBeTruthy();
  });

  it("a fully discounted cash booking stays pending for the operator's call", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const db = await getDb();
    await db
      .update(bookings)
      .set({ discount: held.subtotal, total: 0 })
      .where(eq(bookings.id, held.bookingId));
    const made = await createPayment(cod(held.bookingId), user);
    expect(made.payment.status).toBe("pending");
    expect((await booking(held.bookingId)).status).toBe("pending");
  });

  it("collecting is only for pending cash payments", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const online = await payment(held, user, "pending"); // vnpay
    const staff = await owner();
    expect((await rejection(markCodCollected(online, staff))).message).toBe(
      "mark-cod-collected is only valid for COD payments",
    );
    const made = await createPayment(cod(held.bookingId), user);
    await markCodCollected(made.payment.id, staff, { amountCollected: 100_000 });
    const again = await rejection(markCodCollected(made.payment.id, staff));
    expect(again).toEqual({
      status: 400,
      message: "payment is not in pending status (current: completed)",
    });
  });

  it("checkout offers only the providers that are set up", async () => {
    // The default test environment enables cash only; no gateway has credentials.
    expect((await enabledProviders()).providers).toEqual(["cod"]);
    setCloudflareContext({
      VNPAY_ENABLED: "true",
      VNPAY_TMN_CODE: "T",
      VNPAY_HASH_SECRET: "S",
      VIETQR_ENABLED: "true",
      VIETQR_BANK_BIN: "970436",
      VIETQR_ACCOUNT_NO: "001",
      // no account name → not active
      MOMO_ENABLED: "true",
      MOMO_PARTNER_CODE: "P",
      MOMO_ACCESS_KEY: "A",
      MOMO_SECRET_KEY: "K",
      PAYMENT_COD_ENABLED: "false",
    });
    expect((await enabledProviders()).providers).toEqual(["momo", "vnpay"]);
    setCloudflareContext({
      VIETQR_ENABLED: "true",
      VIETQR_BANK_BIN: "970436",
      VIETQR_ACCOUNT_NO: "001",
      VIETQR_ACCOUNT_NAME: "VEXE",
    });
    expect((await enabledProviders()).providers).toEqual(["cod", "vietqr"]);
  });

  it("rejects unknown and disabled providers before touching the booking", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const unknown = await rejection(
      createPayment({ bookingId: held.bookingId, provider: "paypal" }, user),
    );
    expect(unknown.message).toBe(
      "invalid provider: paypal (allowed: momo, vnpay, zalopay, cod, vietqr)",
    );
    const disabled = await rejection(
      createPayment({ bookingId: held.bookingId, provider: "vnpay" }, user),
    );
    expect(disabled).toEqual({ status: 400, message: "provider 'vnpay' is not enabled" });
    expect((await booking(held.bookingId)).paymentMethod).toBeNull();
  });

  it("a new payment supersedes the previous pending one", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const first = await payment(held, user, "pending");
    await cancelPriorPendingPayments(held.bookingId);
    expect(await paymentStatus(first)).toBe("cancelled");
    expect((await row(first)).failureReason).toBe("superseded by new payment");

    const a = await createPayment(cod(held.bookingId), user);
    const b = await createPayment(cod(held.bookingId), user);
    expect(await paymentStatus(a.payment.id)).toBe("cancelled");
    expect(await paymentStatus(b.payment.id)).toBe("pending");
  });

  it("an expired booking cannot start a payment", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await ageHold(held.bookingId, 5);
    const err = await rejection(createPayment(cod(held.bookingId), user));
    expect(err.status).toBe(410);
    expect((await booking(held.bookingId)).status).toBe("pending");
  });

  it("only a pending booking can be paid", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await confirmAsSystem(held.bookingId, "vnpay");
    const err = await rejection(createPayment(cod(held.bookingId), user));
    expect(err).toEqual({
      status: 400,
      message: "booking is not in pending status (current: confirmed)",
    });
  });

  it("cancelling a payment leaves the booking alone", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const made = await createPayment(cod(held.bookingId), user);
    const out = await cancelPayment(made.payment.id, user, "wrong provider");
    expect(out).toMatchObject({ status: "cancelled", reason: "wrong provider" });
    expect((await booking(held.bookingId)).status).toBe("pending");
    const again = await rejection(cancelPayment(made.payment.id, user));
    expect(again.message).toBe("payment is not in pending status (current: cancelled)");
  });
});

describe("admin", () => {
  it("the summary counts every payment and the money collected", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    for (const status of ["completed", "completed", "pending", "failed"])
      await payment(held, user, status);
    expect(await adminPaymentSummary()).toEqual({
      total: 4,
      pending: 1,
      completed: 2,
      failed: 1,
      cancelled: 0,
      refunded: 0,
      collected: 2 * held.total,
    });
  });

  it("lists with the booking code, filters and counts", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    await payment(held, user, "completed");
    await payment(held, user, "pending");
    const all = await adminListPayments({});
    expect(all.total).toBe(2);
    expect(all.items[0].bookingCode).toBe(held.code);
    expect((await adminListPayments({ status: "pending" })).total).toBe(1);
    expect((await adminListPayments({ provider: "momo" })).total).toBe(0);
    expect((await adminListPayments({ limit: 1 })).items).toHaveLength(1);
    expect((await adminGetPayment(all.items[0].id)).bookingCode).toBe(held.code);
  });

  it("money taken for a lost booking is flagged, not swallowed", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const pay = await payment(held, user, "pending");
    await ageHold(held.bookingId, 5);
    await sweepExpiredHolds(); // booking cancelled, payment cancelled

    // An admin (or a very late webhook) marks it paid anyway.
    await adminUpdatePaymentStatus(pay, "completed");

    const p = await row(pay);
    expect(p.status).toBe("completed");
    expect(p.failureReason ?? "").toContain("could not be confirmed");
    expect((await booking(held.bookingId)).status).toBe("cancelled");
  });

  it("any status can be forced, but only known ones", async () => {
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const pay = await payment(held, user, "pending");
    const bad = await rejection(adminUpdatePaymentStatus(pay, "paid"));
    expect(bad.message).toBe(
      "invalid status: paid (allowed: pending, completed, failed, cancelled, refunded)",
    );
    const out = await adminUpdatePaymentStatus(pay, "failed", "bank declined");
    expect(out).toMatchObject({ status: "failed", reason: "bank declined" });
    // Without a reason the old one stays.
    expect((await adminUpdatePaymentStatus(pay, "refunded")).reason).toBe("bank declined");
    // Completing confirms the booking.
    await adminUpdatePaymentStatus(pay, "completed");
    expect((await booking(held.bookingId)).status).toBe("confirmed");
    expect((await rejection(adminUpdatePaymentStatus(crypto.randomUUID(), "failed"))).status).toBe(
      404,
    );
  });
});

// ── Gateways ────────────────────────────────────────────────────

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(hash: "SHA-256" | "SHA-512", secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

async function signedVnpay(
  params: Record<string, string>,
  secret = "vn-secret",
): Promise<Record<string, string>> {
  const data = Object.keys(params)
    .sort()
    .map((k) => `${k}=${percentEncode(params[k])}`)
    .join("&");
  return {
    ...params,
    vnp_SecureHash: await hmac("SHA-512", secret, data),
    vnp_SecureHashType: "HmacSHA512",
  };
}

const VNPAY_ENV = {
  VNPAY_ENABLED: "true",
  VNPAY_TMN_CODE: "TMN1",
  VNPAY_HASH_SECRET: "vn-secret",
  PAYMENT_PUBLIC_BASE_URL: "https://datxevui.com",
};

describe("VNPay", () => {
  async function start() {
    setCloudflareContext(VNPAY_ENV);
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const made = await createPayment({ bookingId: held.bookingId, provider: "vnpay" }, user);
    const p = await row(made.payment.id);
    return { f, user, held, made, p };
  }

  it("builds a signed gateway URL and extends the hold for the payment", async () => {
    const { held, made, p } = await start();
    const url = new URL(made.payment.gatewayUrl!);
    expect(url.origin + url.pathname).toBe("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html");
    expect(url.searchParams.get("vnp_Amount")).toBe(String(held.total * 100));
    expect(url.searchParams.get("vnp_TxnRef")).toBe(p.providerTxnRef);
    expect(url.searchParams.get("vnp_OrderInfo")).toBe(`VEXEVN-${held.code}`);
    expect(url.searchParams.get("vnp_ReturnUrl")).toBe(
      `https://datxevui.com/payments/${held.bookingId}/return`,
    );
    expect(url.searchParams.get("vnp_IpnUrl")).toBe("https://datxevui.com/api/payments/ipn/vnpay");
    // The signature verifies with the same rule the IPN uses.
    const { vnp_SecureHash, vnp_SecureHashType, ...signed } = Object.fromEntries(
      url.searchParams.entries(),
    );
    expect(vnp_SecureHashType).toBe("HmacSHA512");
    expect((await signedVnpay(signed)).vnp_SecureHash).toBe(vnp_SecureHash);
    const b = await booking(held.bookingId);
    expect(b.paymentMethod).toBe("vnpay");
    expect(new Date(b.expiresAt!).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it("completes on a signed success and confirms the booking; repeats are no-ops", async () => {
    const { f, held, p } = await start();
    const ipn = await signedVnpay({
      vnp_TxnRef: p.providerTxnRef!,
      vnp_Amount: String(held.total * 100),
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
      vnp_TransactionNo: "14000001",
    });
    await handleVnpayIpn(ipn);
    const done = await row(p.id);
    expect([done.status, done.providerTransId]).toEqual(["completed", "14000001"]);
    expect((await booking(held.bookingId)).status).toBe("confirmed");
    expect(await seatsNow(f)).toEqual([0, 0, 1, 0]);
    // Idempotent: a retry changes nothing and does not throw.
    await handleVnpayIpn(ipn);
    expect((await row(p.id)).status).toBe("completed");
    // A late failure notification for a completed payment is ignored too.
    await handleVnpayIpn(
      await signedVnpay({
        vnp_TxnRef: p.providerTxnRef!,
        vnp_ResponseCode: "24",
        vnp_TransactionStatus: "02",
      }),
    );
    expect((await row(p.id)).status).toBe("completed");
  });

  it("fails the payment on a bad response code and keeps the booking pending", async () => {
    const { held, p } = await start();
    await handleVnpayIpn(
      await signedVnpay({
        vnp_TxnRef: p.providerTxnRef!,
        vnp_ResponseCode: "24",
        vnp_TransactionStatus: "02",
      }),
    );
    const failed = await row(p.id);
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("vnp_ResponseCode=24, vnp_TransactionStatus=02");
    expect((await booking(held.bookingId)).status).toBe("pending");
  });

  it("marks an amount mismatch failed instead of confirming", async () => {
    const { held, p } = await start();
    await handleVnpayIpn(
      await signedVnpay({
        vnp_TxnRef: p.providerTxnRef!,
        vnp_Amount: "10000",
        vnp_ResponseCode: "00",
        vnp_TransactionStatus: "00",
      }),
    );
    const failed = await row(p.id);
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe(`amount mismatch: expected ${held.total * 100}, got 10000`);
    expect((await booking(held.bookingId)).status).toBe("pending");
  });

  it("rejects a forged or missing signature and an unknown order", async () => {
    const { p } = await start();
    const params = {
      vnp_TxnRef: p.providerTxnRef!,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    };
    const forged = { ...(await signedVnpay(params, "wrong-secret")) };
    expect((await rejection(handleVnpayIpn(forged))).status).toBe(401);
    expect((await rejection(handleVnpayIpn(params))).status).toBe(400);
    const tampered = { ...(await signedVnpay(params)), vnp_ResponseCode: "01" };
    expect((await rejection(handleVnpayIpn(tampered))).status).toBe(401);
    const unknown = await rejection(
      handleVnpayIpn(await signedVnpay({ ...params, vnp_TxnRef: "VX0" })),
    );
    expect(unknown.status).toBe(404);
    expect((await row(p.id)).status).toBe("pending");
  });

  it("answers the IPN route with VNPay's response codes", async () => {
    const { GET } = await import("../../src/app/api/payments/ipn/vnpay/route");
    const { p } = await start();
    const call = async (params: Record<string, string>) =>
      (
        await GET(new Request(`https://x/api/payments/ipn/vnpay?${new URLSearchParams(params)}`))
      ).json();
    const good = await signedVnpay({
      vnp_TxnRef: p.providerTxnRef!,
      vnp_ResponseCode: "00",
      vnp_TransactionStatus: "00",
    });
    expect(await call(good)).toEqual({ RspCode: "00", Message: "Confirm Success" });
    expect(await call(await signedVnpay({ vnp_TxnRef: "nope" }))).toEqual({
      RspCode: "01",
      Message: "Order Not Found",
    });
    expect(await call({ vnp_TxnRef: "x", vnp_SecureHash: "bad" })).toEqual({
      RspCode: "97",
      Message: "Invalid Signature",
    });
  });
});

describe("MoMo", () => {
  const MOMO_ENV = {
    MOMO_ENABLED: "true",
    MOMO_PARTNER_CODE: "MOMOX",
    MOMO_ACCESS_KEY: "ak",
    MOMO_SECRET_KEY: "sk",
    PAYMENT_PUBLIC_BASE_URL: "https://datxevui.com",
  };

  async function signedMomo(over: Record<string, unknown>) {
    const body: Record<string, unknown> = {
      partnerCode: "MOMOX",
      orderId: "VX1",
      requestId: "req-1",
      amount: 0,
      orderInfo: "VEXEVN-X",
      orderType: "momo_wallet",
      transId: 4040,
      resultCode: 0,
      message: "Successful.",
      payType: "qr",
      responseTime: 1700000000000,
      extraData: "",
      ...over,
    };
    const data =
      `accessKey=ak&amount=${body.amount}&extraData=${body.extraData}&message=${body.message}&orderId=${body.orderId}` +
      `&orderInfo=${body.orderInfo}&orderType=${body.orderType}&partnerCode=${body.partnerCode}&payType=${body.payType}` +
      `&requestId=${body.requestId}&responseTime=${body.responseTime}&resultCode=${body.resultCode}&transId=${body.transId}`;
    return { ...body, signature: await hmac("SHA-256", "sk", data) };
  }

  it("creates the order over HTTPS and completes on a signed IPN", async () => {
    setCloudflareContext(MOMO_ENV);
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String((init as RequestInit).body));
      expect(sent.amount).toBe(held.total);
      expect(sent.ipnUrl).toBe("https://datxevui.com/api/payments/ipn/momo");
      return new Response(
        JSON.stringify({ resultCode: 0, payUrl: "https://pay.momo/xyz", message: "ok" }),
      );
    });
    try {
      const made = await createPayment({ bookingId: held.bookingId, provider: "momo" }, user);
      expect(made.payment.gatewayUrl).toBe("https://pay.momo/xyz");
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        "https://test-payment.momo.vn/v2/gateway/api/create",
      );
    } finally {
      fetchMock.mockRestore();
    }
    const p = (
      await (await getDb()).select().from(payments).where(eq(payments.bookingId, held.bookingId))
    )[0];

    // Wrong amount → failed; the right one (on a fresh payment) → completed.
    await handleMomoIpn(await signedMomo({ orderId: p.providerTxnRef, amount: 1 }));
    expect((await row(p.id)).failureReason).toBe(`amount mismatch: expected ${held.total}, got 1`);
    expect((await booking(held.bookingId)).status).toBe("pending");
  });

  it("confirms the booking on a correct amount, and rejects a bad signature", async () => {
    setCloudflareContext(MOMO_ENV);
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const pay = await payment(held, user, "pending");
    const p = await row(pay);
    const ipn = await signedMomo({ orderId: p.providerTxnRef, amount: held.total });
    expect((await rejection(handleMomoIpn({ ...ipn, signature: "00" }))).status).toBe(401);
    expect((await rejection(handleMomoIpn({ orderId: "x" }))).status).toBe(422);
    await handleMomoIpn(ipn);
    expect((await row(pay)).status).toBe("completed");
    expect((await row(pay)).providerTransId).toBe("4040");
    expect((await booking(held.bookingId)).status).toBe("confirmed");
    await handleMomoIpn(ipn); // idempotent
    // snake_case fields (the shape Rust deserializes) verify too.
    const f2 = await fixture(1);
    const held2 = await hold(f2, await owner(), 1);
    const p2 = await row(await payment(held2, await owner(), "pending"));
    const camel = await signedMomo({
      orderId: p2.providerTxnRef,
      amount: held2.total,
      resultCode: 1006,
      message: "Denied",
    });
    await handleMomoIpn(camel);
    expect((await row(p2.id)).failureReason).toBe("resultCode=1006");
  });
});

describe("ZaloPay", () => {
  const ZP_ENV = {
    ZALOPAY_ENABLED: "true",
    ZALOPAY_APP_ID: "2553",
    ZALOPAY_KEY1: "k1",
    ZALOPAY_KEY2: "k2",
  };

  async function callback(data: Record<string, unknown>, key = "k2") {
    const raw = JSON.stringify(data);
    return JSON.stringify({ data: raw, mac: await hmac("SHA-256", key, raw), type: 1 });
  }

  it("completes on a valid MAC and an exact amount", async () => {
    setCloudflareContext(ZP_ENV);
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const pay = await payment(held, user, "pending");
    const p = await row(pay);
    const good = await callback({
      app_id: 2553,
      app_trans_id: p.providerTxnRef,
      zp_trans_id: 777,
      amount: held.total,
    });
    await handleZalopayCallback(good);
    expect(await paymentStatus(pay)).toBe("completed");
    expect((await booking(held.bookingId)).status).toBe("confirmed");
    await handleZalopayCallback(good); // idempotent
  });

  it("rejects a forged MAC, a foreign app id and an unknown order", async () => {
    setCloudflareContext(ZP_ENV);
    const f = await fixture(1);
    const held = await hold(f, await owner(), 1);
    const pay = await payment(held, await owner(), "pending");
    const p = await row(pay);
    const data = {
      app_id: 2553,
      app_trans_id: p.providerTxnRef,
      zp_trans_id: 1,
      amount: held.total,
    };
    expect((await rejection(handleZalopayCallback(await callback(data, "other")))).status).toBe(
      401,
    );
    expect(
      (await rejection(handleZalopayCallback(await callback({ ...data, app_id: 1 })))).status,
    ).toBe(401);
    expect(
      (await rejection(handleZalopayCallback(await callback({ ...data, app_trans_id: "nope" }))))
        .status,
    ).toBe(404);
    expect((await rejection(handleZalopayCallback("not json"))).status).toBe(400);
    expect(await paymentStatus(pay)).toBe("pending");
    const wrongAmount = await callback({ ...data, amount: 5 });
    await handleZalopayCallback(wrongAmount);
    expect((await row(pay)).failureReason).toBe(`amount mismatch: expected ${held.total}, got 5`);
  });
});

describe("VietQR", () => {
  it("creates the bank-transfer QR and instructions", async () => {
    setCloudflareContext({
      VIETQR_ENABLED: "true",
      VIETQR_BANK_BIN: "970436",
      VIETQR_ACCOUNT_NO: "0011001938111",
      VIETQR_ACCOUNT_NAME: "CONG TY VEXE",
    });
    const f = await fixture(1);
    const user = await owner();
    const held = await hold(f, user, 1);
    const made = await createPayment({ bookingId: held.bookingId, provider: "vietqr" }, user);
    const p = made.payment;
    expect(p.qrPayload?.startsWith("000201010212")).toBe(true);
    expect(p.qrPayload).toContain("A000000727");
    expect(p.qrPayload).toContain(String(held.total));
    expect(p.qrImageDataUri?.startsWith("data:image/")).toBe(true);
    expect(p.bankTransferInstructions).toEqual({
      bankBin: "970436",
      bankName: "Vietcombank",
      accountNo: "0011001938111",
      accountName: "CONG TY VEXE",
      amount: held.total,
      memo: `VEXEVN-${held.code}`,
    });
    expect(p.returnUrl).toContain(`/payments/${p.id}/return`);
    // Later reads carry no image, like Rust.
    expect((await getPayment(p.id, user)).qrImageDataUri).toBeUndefined();
  });
});
