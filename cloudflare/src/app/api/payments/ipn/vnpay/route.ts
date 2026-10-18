import { rawAll, atomicBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";
import { getEnv } from "@/lib/db/client";

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `GET /api/payments/ipn/vnpay` — VNPay server-to-server notification.
 * Verifies vnp_SecureHash (HMAC-SHA512 over sorted params), completes the
 * payment on vnp_ResponseCode=00 and confirms the booking.
 */
export async function GET(req: Request) {
  try {
    const env = await getEnv();
    const url = new URL(req.url);
    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (k !== "vnp_SecureHash" && k !== "vnp_SecureHashType") params[k] = v;
    }
    const secureHash = url.searchParams.get("vnp_SecureHash") ?? "";
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(params[k]!)}`)
      .join("&");

    if (env.VNPAY_HASH_SECRET) {
      const expected = await hmacSha512Hex(env.VNPAY_HASH_SECRET, sorted);
      if (expected.toLowerCase() !== secureHash.toLowerCase()) {
        return Response.json({ code: "97", message: "Checksum failed" });
      }
    } else if (env.APP_ENV !== "development") {
      return Response.json({ code: "97", message: "Checksum failed" });
    }

    const txnRef = params["vnp_TxnRef"] ?? "";
    const responseCode = params["vnp_ResponseCode"] ?? "99";
    const rows = await rawAll<{ id: string; booking_id: string; status: string }>(
      sql`SELECT id, booking_id, status FROM payment WHERE provider_txn_ref = ${txnRef} LIMIT 1`,
    );
    const payment = rows[0];
    if (!payment) return Response.json({ code: "01", message: "Order not found" });

    const now = new Date().toISOString();
    if (responseCode === "00" && payment.status === "pending") {
      await atomicBatch([
        sql`UPDATE payment SET status = 'completed', provider_trans_id = ${params["vnp_TransactionNo"] ?? null}, updated_at = ${now} WHERE id = ${payment.id}`,
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
    } else if (responseCode !== "00" && payment.status === "pending") {
      await atomicBatch([
        sql`UPDATE payment SET status = 'failed', failure_reason = ${params["vnp_Message"] ?? "gateway declined"}, updated_at = ${now} WHERE id = ${payment.id}`,
      ]);
    }
    return Response.json({ code: "00", message: "Confirmed" });
  } catch (e) {
    return handleRouteError(e);
  }
}
