import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { adminUpdatePaymentStatus } from "@/lib/services/payment";

/**
 * `PATCH /api/admin/payments/{id}` — force a payment status with an optional
 * reason. Marking a payment `completed` also confirms its booking.
 */
export const PATCH = staffRoute<IdParams>("admin:payments:write", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = await readJson<{ status: string; reason?: string | null }>(req);
  return Response.json(await adminUpdatePaymentStatus(id, body.status, body.reason));
});
