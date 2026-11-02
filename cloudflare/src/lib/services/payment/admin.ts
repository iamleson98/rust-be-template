/** Staff payment operations: the list, the summary and manual status changes. */
import { getDb } from "@/lib/db/client";
import { bookings, payments } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { badRequest } from "../http-errors";
import { nowIso } from "./codec";
import { STATUSES } from "./config";
import { confirmPaidBooking, findPayment } from "./operations";
import { adminPaymentOut, orUndefined } from "./output";

// ── Admin operations ─────────────────────────────────────────────

export async function adminListPayments(q: {
  status?: string | null;
  provider?: string | null;
  limit?: number | null;
  offset?: number | null;
}) {
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 200);
  const offset = q.offset ?? 0;
  const db = await getDb();
  const where = and(
    q.status ? eq(payments.status, q.status) : undefined,
    q.provider ? eq(payments.provider, q.provider) : undefined,
  );
  const rows = await db
    .select({ payment: payments, bookingCode: bookings.code })
    .from(payments)
    .leftJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(where)
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(payments)
    .where(where);
  return {
    items: rows.map((r) => adminPaymentOut(r.payment, r.bookingCode)),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

/** Totals over every payment: how many per status and the money collected. */
export async function adminPaymentSummary() {
  const db = await getDb();
  const rows = await db
    .select({
      status: payments.status,
      n: sql<number>`COUNT(*)`,
      amount: sql<number | null>`SUM(${payments.amount})`,
    })
    .from(payments)
    .groupBy(payments.status);
  const summary = {
    total: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    refunded: 0,
    collected: 0,
  };
  for (const r of rows) {
    const n = Number(r.n);
    summary.total += n;
    if (r.status === "pending") summary.pending = n;
    else if (r.status === "completed") {
      summary.completed = n;
      summary.collected = Number(r.amount ?? 0);
    } else if (r.status === "failed") summary.failed = n;
    else if (r.status === "cancelled") summary.cancelled = n;
    else if (r.status === "refunded") summary.refunded = n;
  }
  return summary;
}

/**
 * Manual override of a payment's status. Marking a payment `completed` also
 * confirms its booking (a failure to do so is written on the payment).
 */
export async function adminUpdatePaymentStatus(id: string, status: string, reason?: string | null) {
  if (typeof status !== "string" || status.length < 1 || status.length > 16)
    throw badRequest("status has an invalid length");
  if (reason != null && reason.length > 1000) throw badRequest("reason has an invalid length");
  if (!(STATUSES as readonly string[]).includes(status))
    throw badRequest(`invalid status: ${status} (allowed: ${STATUSES.join(", ")})`);
  const p = await findPayment(id);
  const now = nowIso();
  const db = await getDb();
  await db
    .update(payments)
    .set({ status, updatedAt: now, ...(reason != null ? { failureReason: reason } : {}) })
    .where(eq(payments.id, id));
  if (status === "completed") await confirmPaidBooking(p);
  const updated = await findPayment(id);
  return {
    paymentId: id,
    status,
    reason: orUndefined(updated.failureReason),
    updatedAt: now,
  };
}
