import { handleRouteError, requireStaff } from "@/lib/api";
import { pageOf } from "@/lib/query";
import { adminCouponList } from "@/lib/services/admin";

/**
 * `GET /api/admin/coupons?campaignId=&brandId=&status=&limit=&offset=` — the
 * coupon ledger. Rust kept it to admins; here employees read it too, for
 * support follow-ups, so any staff session will do.
 */
export async function GET(req: Request) {
  try {
    await requireStaff(req);
    const q = new URL(req.url).searchParams;
    return Response.json(
      await adminCouponList({
        campaignId: q.get("campaignId") ?? undefined,
        brandId: q.get("brandId") ?? undefined,
        status: q.get("status") ?? undefined,
        ...pageOf(q, { limit: 20, max: 100 }),
      }),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
