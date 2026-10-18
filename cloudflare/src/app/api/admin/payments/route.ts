import { getDb } from "@/lib/db/client";
import { and, desc, eq, sql } from "drizzle-orm";
import { bookings, payments } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/payments?status=&provider=&limit=&offset=` — all
 * payments (Rust `AdminPaymentListResponse` with bookingCode). Typed
 * builder + a COUNT query sharing the same WHERE.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:read");
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const provider = url.searchParams.get("provider");
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      100,
    );
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const where = and(
      status != null ? eq(payments.status, status) : undefined,
      provider != null ? eq(payments.provider, provider) : undefined,
    );

    const db = await getDb();
    const rows = await db
      .select({ payment: payments, bookingCode: bookings.code })
      .from(payments)
      .leftJoin(bookings, eq(bookings.id, payments.bookingId))
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset(offset);
    const totalRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(payments)
      .where(where);
    const total = totalRows[0]?.count ?? 0;

    return Response.json({
      items: rows.map(({ payment: p, bookingCode }) => ({
        id: p.id,
        bookingId: p.bookingId,
        bookingCode,
        userId: p.userId,
        amount: Number(p.amount),
        currency: p.currency,
        provider: p.provider,
        providerTxnRef: p.providerTxnRef,
        providerTransId: p.providerTransId,
        status: p.status,
        gatewayUrl: p.gatewayUrl,
        qrPayload: p.qrPayload,
        failureReason: p.failureReason,
        memo: p.memo,
        collectedAt: p.collectedAt,
        collectedBy: p.collectedBy,
        providerResponse: p.providerResponse,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      total,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
