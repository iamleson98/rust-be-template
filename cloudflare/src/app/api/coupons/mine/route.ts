import { handleRouteError, requireUser } from "@/lib/api";
import { couponWallet, giveUpCoupon } from "@/lib/services/coupons";

/** `GET /api/coupons/mine` — the held coupon and the campaigns claimed from. */
export async function GET(req: Request) {
  try {
    return Response.json(await couponWallet((await requireUser(req)).id));
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * `DELETE /api/coupons/mine` — give up the held coupon; its slot goes back
 * while the campaign runs. 404 when there is none (a booked one cannot be).
 */
export async function DELETE(req: Request) {
  try {
    return Response.json(await giveUpCoupon((await requireUser(req)).id));
  } catch (e) {
    return handleRouteError(e);
  }
}
