import { ApiError } from "@/lib/auth/rbac";
import { handleVnpayIpn } from "@/lib/services/payment";

/**
 * `GET /api/payments/ipn/vnpay` — VNPay server-to-server notification. The
 * answer is always HTTP 200 with VNPay's `RspCode`: 00 processed, 01 order
 * not found, 97 anything that could not be verified.
 */
export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    await handleVnpayIpn(params);
    return Response.json({ RspCode: "00", Message: "Confirm Success" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      console.warn("[ipn] VNPay: payment not found", e.message);
      return Response.json({ RspCode: "01", Message: "Order Not Found" });
    }
    console.warn("[ipn] VNPay verification failed", e);
    return Response.json({ RspCode: "97", Message: "Invalid Signature" });
  }
}
