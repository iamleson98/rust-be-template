import { adminRoute, readJson, type IdParams } from "@/lib/api";
import { rejectCoupon } from "@/lib/services/admin";

/** `POST /api/admin/coupons/{id}/reject` — refuse to pay a redeemed coupon (`{ reason }`). */
export const POST = adminRoute<IdParams>(async (req, { params }) => {
  const body = await readJson<{ reason?: unknown }>(req);
  return Response.json(await rejectCoupon((await params).id, body?.reason));
});
