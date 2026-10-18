import { rawAll, rawBatch } from "@/lib/db/client";
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
 * `POST /api/payments/ipn/zalopay` — ZaloPay callback. Verifies `mac`
 * (HMAC-SHA256 of the JSON data field) and completes on returnCode 1/2.
 */
export async function POST(req: Request) {
  try {
    const env = await getEnv();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data = String(body.data ?? "{}");
    const mac = String(body.mac ?? "");

    if (env.ZALOPAY_KEY1 && mac) {
      const expected = await hmacSha256Hex(env.ZALOPAY_KEY1, data);
      if (expected.toLowerCase() !== mac.toLowerCase()) {
        return Response.json({ return_code: 0, return_message: "mac mismatch" });
      }
    } else if (env.APP_ENV !== "development") {
      return Response.json({ return_code: 0, return_message: "mac mismatch" });
    }

    const payload = JSON.parse(data) as { app_trans_id?: string };
    // app_trans_id = "yyyymmdd_txnRef" — the tail is our reference.
    const txnRef = (payload.app_trans_id ?? "").split("_").slice(1).join("_");
    const returnCode = Number(body.code ?? body.return_code ?? 2);
    const rows = await rawAll<{ id: string; booking_id: string; status: string }>(
      sql`SELECT id, booking_id, status FROM payment WHERE provider_txn_ref = ${txnRef} LIMIT 1`,
    );
    const payment = rows[0];
    if (!payment) return Response.json({ return_code: 0, return_message: "order not found" });

    const now = new Date().toISOString();
    if ((returnCode === 1 || returnCode === 2) && payment.status === "pending") {
      await rawBatch([
        sql`UPDATE payment SET status = 'completed', updated_at = ${now} WHERE id = ${payment.id}`,
        sql`UPDATE booking SET status = 'confirmed', updated_at = ${now} WHERE id = ${payment.booking_id} AND status = 'pending'`,
        sql`
          UPDATE seat_inventory SET status = 'booked', held_until = NULL, updated_at = ${now}
          WHERE held_by_booking_id = ${payment.booking_id} AND status = 'held'
        `,
      ]);
    } else if (returnCode !== 1 && returnCode !== 2 && payment.status === "pending") {
      await rawBatch([
        sql`UPDATE payment SET status = 'failed', failure_reason = 'gateway declined', updated_at = ${now} WHERE id = ${payment.id}`,
      ]);
    }
    return Response.json({ return_code: 1, return_message: "Success" });
  } catch (e) {
    return handleRouteError(e);
  }
}
