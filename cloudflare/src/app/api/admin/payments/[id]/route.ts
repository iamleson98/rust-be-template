import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminUpdatePaymentStatus } from "@/lib/services/payment";

type Params = { params: Promise<{ id: string }> };

/**
 * `PATCH /api/admin/payments/{id}` — force a payment status with an optional
 * reason. Marking a payment `completed` also confirms its booking.
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:write");
    const { id } = await ctx.params;
    const body = await readJson<{ status: string; reason?: string | null }>(req);
    return Response.json(await adminUpdatePaymentStatus(id, body.status, body.reason));
  } catch (e) {
    return handleRouteError(e);
  }
}
