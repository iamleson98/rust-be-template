import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminPaymentSummary } from "@/lib/services/payment";

/** `GET /api/admin/payments/summary` — payments per status and the money collected. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:read");
    return Response.json(await adminPaymentSummary());
  } catch (e) {
    return handleRouteError(e);
  }
}
