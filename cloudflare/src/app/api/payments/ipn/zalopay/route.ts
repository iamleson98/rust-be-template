import { ApiError } from "@/lib/auth/rbac";
import { handleZalopayCallback } from "@/lib/services/payment";

/**
 * `POST /api/payments/ipn/zalopay` — ZaloPay callback. HTTP 200 with
 * `return_code` 1 processed, 2 order not found, 3 invalid MAC; a body that
 * cannot be read is rejected with 400.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    await handleZalopayCallback(raw);
    return Response.json({ return_code: 1, return_message: "Success" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 400)
      return Response.json({ error: { code: e.code, message: e.message } }, { status: 400 });
    if (e instanceof ApiError && e.status === 404) {
      console.warn("[ipn] ZaloPay: payment not found", e.message);
      return Response.json({ return_code: 2, return_message: "Order Not Found" });
    }
    console.warn("[ipn] ZaloPay callback verification failed", e);
    return Response.json({ return_code: 3, return_message: "Invalid MAC" });
  }
}
