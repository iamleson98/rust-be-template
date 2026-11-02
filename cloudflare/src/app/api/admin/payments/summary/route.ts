import { staffRoute } from "@/lib/api";
import { adminPaymentSummary } from "@/lib/services/payment";

/** `GET /api/admin/payments/summary` — payments per status and the money collected. */
export const GET = staffRoute("admin:payments:read", async () => {
  return Response.json(await adminPaymentSummary());
});
