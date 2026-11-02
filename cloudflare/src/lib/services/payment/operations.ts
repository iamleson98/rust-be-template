/** What a customer does with a payment (create, read, cancel) and how a collected payment confirms its booking. */
import { getDb } from "@/lib/db/client";
import { bookings, payments } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { ApiError } from "@/lib/auth/rbac";
import {
  badRequest,
  confirmAsSystem,
  forbidden,
  gone,
  holdExpired,
  holdForPayment,
  holdUntilDeparture,
  notFound,
} from "../booking";
import { buildMemo, nowIso } from "./codec";
import { PROVIDERS, PaymentRow, isActive, paymentConfig } from "./config";
import { PaymentOut, paymentOut } from "./output";
import {
  CreateInput,
  createCod,
  createMomo,
  createVietqr,
  createVnpay,
  createZalopay,
} from "./providers";

// ── Ownership ────────────────────────────────────────────────────

/**
 * A booking and its payments belong to the user who made the booking. Only
 * a booking with no owner at all (a legacy guest booking) is open to
 * whoever holds its id. Signed-out callers get 401 on an owned booking so
 * the client can send them to sign in.
 */
export function ensureOwner(owner: string | null, caller: string | null): void {
  if (!owner) return;
  if (!caller) throw new ApiError(401, "unauthorized", "sign in to continue");
  if (caller !== owner) throw forbidden("not your booking");
}

export async function findPayment(id: string): Promise<PaymentRow> {
  const db = await getDb();
  const p = (await db.select().from(payments).where(eq(payments.id, id)).limit(1))[0];
  if (!p) throw notFound("payment not found");
  return p;
}

/** The payment's owner: the user stored on the payment, else the booking's. */
async function assertOwnership(p: PaymentRow, caller: string | null): Promise<void> {
  let owner = p.userId;
  if (!owner) {
    const db = await getDb();
    const b = (await db.select().from(bookings).where(eq(bookings.id, p.bookingId)).limit(1))[0];
    owner = b?.userId ?? null;
  }
  ensureOwner(owner, caller);
}

// ── User-facing operations ───────────────────────────────────────

const ALLOWED = PROVIDERS.join(", ");

/**
 * Create a payment intent for a booking: the booking must be `pending` and
 * its hold alive; a previous pending payment is cancelled (one active
 * payment per booking); the provider is asked for the gateway URL / QR.
 */
export async function createPayment(
  req: { bookingId: string; provider: string },
  callerId: string | null,
): Promise<{ payment: PaymentOut }> {
  if (typeof req.provider !== "string" || req.provider.length < 1 || req.provider.length > 16)
    throw badRequest("provider has an invalid length");
  if (!(PROVIDERS as readonly string[]).includes(req.provider))
    throw badRequest(`invalid provider: ${req.provider} (allowed: ${ALLOWED})`);

  const db = await getDb();
  const booking = (
    await db.select().from(bookings).where(eq(bookings.id, req.bookingId)).limit(1)
  )[0];
  if (!booking) throw notFound("booking not found");
  ensureOwner(booking.userId, callerId);
  if (booking.status !== "pending")
    throw badRequest(`booking is not in pending status (current: ${booking.status})`);
  if (holdExpired(booking)) throw gone("booking hold has expired");
  // A coupon can cover the whole fare. Gateways refuse a zero amount, so
  // such a booking is placed with pay-on-board (nothing to collect).
  if (booking.total <= 0 && req.provider !== "cod")
    throw badRequest("nothing to pay online: choose pay on board (cod)");

  // Rust checks the provider after placing the booking, so a disabled
  // provider still moved the hold and cancelled the previous payment before
  // failing. Checking first leaves the booking untouched on that failure.
  const cfg = await paymentConfig();
  if (!isActive(cfg, req.provider)) throw badRequest(`provider '${req.provider}' is not enabled`);

  // Paying on board places the booking: its seats wait until departure for
  // the operator's confirmation call. A gateway payment needs longer than
  // the checkout hold; the seats stay put while it runs.
  const held =
    req.provider === "cod"
      ? await holdUntilDeparture(booking, "cod")
      : await holdForPayment(booking.id, req.provider);
  if (!held) throw badRequest("booking is not in pending status");

  await cancelPriorPendingPayments(booking.id);

  const base = cfg.publicBaseUrl.replace(/\/+$/, "");
  const input: CreateInput = {
    paymentId: crypto.randomUUID(),
    bookingCode: booking.code,
    amount: booking.total,
    currency: booking.currency,
    returnUrl: `${base}/payments/${booking.id}/return`,
    ipnUrl: `${base}/api/payments/ipn/${req.provider}`,
    memo: buildMemo(booking.code),
  };
  const result =
    req.provider === "vnpay"
      ? await createVnpay(cfg, input)
      : req.provider === "momo"
        ? await createMomo(cfg, input)
        : req.provider === "zalopay"
          ? await createZalopay(cfg, input)
          : req.provider === "vietqr"
            ? createVietqr(cfg, input)
            : createCod(input);

  const now = nowIso();
  const row: PaymentRow = {
    id: crypto.randomUUID(),
    bookingId: booking.id,
    userId: booking.userId,
    provider: req.provider,
    status: "pending",
    amount: booking.total,
    currency: booking.currency,
    createdAt: now,
    updatedAt: now,
    providerTxnRef: result.providerTxnRef,
    providerTransId: null,
    gatewayUrl: result.gatewayUrl,
    qrPayload: result.qrPayload,
    memo: input.memo,
    providerResponse: result.providerResponse,
    failureReason: null,
    createdBy: callerId,
    collectedAt: null,
    collectedBy: null,
  };
  await db.insert(payments).values(row);
  return { payment: await paymentOut(row, cfg, { withQrImage: true }) };
}

/** Cancel every pending payment of a booking (one active payment at a time). */
export async function cancelPriorPendingPayments(bookingId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: nowIso(), failureReason: "superseded by new payment" })
    .where(and(eq(payments.bookingId, bookingId), eq(payments.status, "pending")));
}

/** A single payment; the caller must own its booking. */
export async function getPayment(id: string, callerId: string | null): Promise<PaymentOut> {
  const p = await findPayment(id);
  await assertOwnership(p, callerId);
  return paymentOut(p, await paymentConfig());
}

/** The payments of a booking, newest first; the caller must own the booking. */
export async function listBookingPayments(
  bookingId: string,
  callerId: string | null,
): Promise<{ items: PaymentOut[] }> {
  const db = await getDb();
  const booking = (await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1))[0];
  if (!booking) throw notFound("booking not found");
  ensureOwner(booking.userId, callerId);
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .orderBy(desc(payments.createdAt));
  const cfg = await paymentConfig();
  return { items: await Promise.all(rows.map((p) => paymentOut(p, cfg))) };
}

/**
 * Cancel a pending payment (user-initiated). Does NOT cancel the booking —
 * the user can immediately create a new payment with a different provider.
 */
export async function cancelPayment(id: string, callerId: string | null, reason?: string | null) {
  if (reason != null && reason.length > 1000) throw badRequest("reason has an invalid length");
  const p = await findPayment(id);
  await assertOwnership(p, callerId);
  if (p.status !== "pending")
    throw badRequest(`payment is not in pending status (current: ${p.status})`);
  const now = nowIso();
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: now, failureReason: reason ?? null })
    .where(eq(payments.id, id));
  return { paymentId: id, status: "cancelled", cancelledAt: now, reason: reason ?? undefined };
}

// ── Completion ───────────────────────────────────────────────────

/**
 * Confirm the booking behind a payment that has been collected. If that is
 * no longer possible (the booking was cancelled or its seats were released)
 * the customer has paid for nothing: say so loudly and write it on the
 * payment so an admin sees it in the payments list. Returns the error.
 */
export async function confirmPaidBooking(p: PaymentRow): Promise<unknown | null> {
  try {
    await confirmAsSystem(p.bookingId, p.provider);
    return null;
  } catch (error) {
    console.error(
      `[payment] payment ${p.id} collected but booking ${p.bookingId} could not be confirmed — refund or fix by hand`,
      error,
    );
    const text = error instanceof Error ? error.message : String(error);
    const db = await getDb();
    await db
      .update(payments)
      .set({
        failureReason: `paid, but the booking could not be confirmed: ${text}`,
        updatedAt: nowIso(),
      })
      .where(eq(payments.id, p.id));
    return error;
  }
}

/**
 * Money was verified: the booking is confirmed FIRST (idempotent), then the
 * payment completes, so a Worker killed between the two leaves a payment
 * that is still `pending` and a gateway retry finishes the job. (Rust
 * completes the payment first, which would strand a paid booking.)
 */
export async function completePayment(
  p: PaymentRow,
  extra: Partial<typeof payments.$inferInsert> = {},
): Promise<unknown | null> {
  const error = await confirmPaidBooking(p);
  const db = await getDb();
  await db
    .update(payments)
    .set({ ...extra, status: "completed", updatedAt: nowIso() })
    .where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
  return error;
}

export async function markFailed(
  p: PaymentRow,
  reason: string,
  providerResponse: string,
): Promise<void> {
  // Conditional so concurrent IPN retries only flip pending → failed.
  const db = await getDb();
  await db
    .update(payments)
    .set({ status: "failed", updatedAt: nowIso(), failureReason: reason, providerResponse })
    .where(and(eq(payments.id, p.id), eq(payments.status, "pending")));
}

/**
 * Mark a COD payment as collected (cash received by driver/staff):
 * `pending → completed` and the booking is confirmed.
 */
export async function markCodCollected(
  id: string,
  staffId: string,
  body: { amountCollected?: number | null; note?: string | null } = {},
) {
  if (
    body.amountCollected != null &&
    (!Number.isInteger(body.amountCollected) ||
      body.amountCollected < 0 ||
      body.amountCollected > 1_000_000_000)
  )
    throw badRequest("amount collected is outside the allowed range");
  if (body.note != null && body.note.length > 500) throw badRequest("note has an invalid length");
  const p = await findPayment(id);
  if (p.provider !== "cod") throw badRequest("mark-cod-collected is only valid for COD payments");
  if (p.status !== "pending")
    throw badRequest(`payment is not in pending status (current: ${p.status})`);
  const now = nowIso();
  const error = await completePayment(p, { collectedAt: now, collectedBy: staffId });
  if (error) throw error;
  return {
    paymentId: p.id,
    status: "completed",
    amountCollected: body.amountCollected ?? Number(p.amount),
    collectedAt: now,
  };
}
