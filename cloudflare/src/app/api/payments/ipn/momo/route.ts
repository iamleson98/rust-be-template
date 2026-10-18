import { rawAll, atomicBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { getEnv } from "@/lib/db/client";

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `POST /api/payments/ipn/momo` — MoMo notification. Verifies signature
 * (HMAC-SHA256 over partnerCode.accessKey.requestId.orderId.orderCode
 * .amount.transId.resultCode.message.payType) and completes on 0.
 */
export async function POST(req: Request) {
  try {
    const env = await getEnv();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (k: string) => String(body[k] ?? "");
    const message = [
      "partnerCode",
      "accessKey",
      "requestId",
      "orderId",
      "orderCode",
      "amount",
      "transId",
      "resultCode",
      "message",
      "payType",
    ]
      .map(str)
      .join(".");

    if (env.MOMO_SECRET_KEY && body.signature) {
      const expected = await hmacSha256Hex(env.MOMO_SECRET_KEY, message);
      if (expected.toLowerCase() !== String(body.signature).toLowerCase()) {
        return Response.json({ code: "97", message: "Checksum failed" });
      }
    } else if (env.APP_ENV !== "development") {
      return Response.json({ code: "97", message: "Checksum failed" });
    }

    const txnRef = str("orderId");
    const resultCode = Number(body.resultCode ?? 99);
    const rows = await rawAll<{ id: string; booking_id: string; status: string }>(
      sql`SELECT id, booking_id, status FROM payment WHERE provider_txn_ref = ${txnRef} LIMIT 1`,
    );
    const payment = rows[0];
    if (!payment) return Response.json({ code: "01", message: "Order not found" });

    const now = new Date().toISOString();
    if (resultCode === 0 && payment.status === "pending") {
      await atomicBatch([
        sql`UPDATE payment SET status = 'completed', provider_trans_id = ${str("transId") || null}, updated_at = ${now} WHERE id = ${payment.id}`,
        sql`UPDATE booking SET status = 'confirmed', updated_at = ${now} WHERE id = ${payment.booking_id} AND status = 'pending'`,
        sql`
          UPDATE seat_inventory SET status = 'booked', held_until = NULL, updated_at = ${now}
          WHERE held_by_booking_id = ${payment.booking_id} AND status = 'held'
        `,
        sql`
          UPDATE coupon SET status = 'redeemed', active_holder = NULL, redeemed_at = ${now},
                 updated_at = ${now}
          WHERE booking_id = ${payment.booking_id} AND status = 'reserved'
        `,
      ]);
    } else if (resultCode !== 0 && payment.status === "pending") {
      await atomicBatch([
        sql`UPDATE payment SET status = 'failed', failure_reason = ${str("message") || "gateway declined"}, updated_at = ${now} WHERE id = ${payment.id}`,
      ]);
    }
    return Response.json({ code: "0", message: "Confirmed" });
  } catch (e) {
    return handleRouteError(e);
  }
}
