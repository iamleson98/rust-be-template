import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/**
 * `GET /api/admin/payments?status=&provider=&limit=&offset=` — all
 * payments (Rust `AdminPaymentListResponse` with bookingCode + user info).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:read");
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? undefined;
    const provider = url.searchParams.get("provider") ?? undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

    const rows = await rawAll<{
      id: string;
      booking_id: string;
      booking_code: string | null;
      user_id: string | null;
      user_name: string | null;
      user_phone: string | null;
      provider: string;
      provider_txn_ref: string;
      provider_trans_id: string | null;
      amount: number;
      currency: string;
      status: string;
      gateway_url: string | null;
      qr_payload: string | null;
      failure_reason: string | null;
      memo: string | null;
      collected_at: string | null;
      collected_by: string | null;
      provider_response: string | null;
      created_at: string;
      updated_at: string;
      total: number;
    }>(sql`
      SELECT p.id, p.booking_id, p.user_id, p.provider, p.provider_txn_ref,
             p.provider_trans_id, p.amount, p.currency, p.status, p.gateway_url,
             p.qr_payload, p.failure_reason, p.memo, p.collected_at, p.collected_by,
             p.provider_response, p.created_at, p.updated_at,
             (SELECT b.code FROM booking b WHERE b.id = p.booking_id) AS booking_code,
             (SELECT u.full_name FROM "user" u WHERE u.id = p.user_id) AS user_name,
             (SELECT u.phone FROM "user" u WHERE u.id = p.user_id) AS user_phone,
             (SELECT COUNT(*) FROM payment p2
                ${status ? sql`WHERE p2.status = ${status}` : sql``}
                ${provider ? sql`AND p2.provider = ${provider}` : sql``}
             ) AS total
      FROM payment p
      WHERE 1=1
        ${status ? sql`AND p.status = ${status}` : sql``}
        ${provider ? sql`AND p.provider = ${provider}` : sql``}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return Response.json({
      items: rows.map((p) => ({
        id: p.id,
        bookingId: p.booking_id,
        bookingCode: p.booking_code,
        userId: p.user_id,
        amount: Number(p.amount),
        currency: p.currency,
        provider: p.provider,
        providerTxnRef: p.provider_txn_ref,
        providerTransId: p.provider_trans_id,
        status: p.status,
        gatewayUrl: p.gateway_url,
        qrPayload: p.qr_payload,
        failureReason: p.failure_reason,
        memo: p.memo,
        collectedAt: p.collected_at,
        collectedBy: p.collected_by,
        providerResponse: p.provider_response,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
      total: Number(rows[0]?.total ?? 0),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
