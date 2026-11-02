import { handleRouteError, requireStaff } from "@/lib/api";
import { couponPayouts } from "@/lib/services/admin";

/**
 * `GET /api/admin/coupons/payouts` — what each brand is owed and has been
 * paid for redeemed coupons. Employees read it too, for support follow-ups.
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req);
    return Response.json(await couponPayouts());
  } catch (e) {
    return handleRouteError(e);
  }
}
