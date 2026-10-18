import { rawAll, rawRun } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/**
 * `POST /api/admin/coupons/settle` — mark redeemed coupons as settled
 * (paid out to the brand). Body: `{ brandId?: string }` — brand-scoped or
 * everything outstanding (Rust `SettleCouponsResponse`).
 */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    let brandId: string | undefined;
    try {
      const body = (await req.json()) as { brandId?: string };
      brandId = body.brandId;
    } catch {
      brandId = undefined;
    }
    const now = new Date().toISOString();
    const result = await rawRun(sql`
      UPDATE coupon
      SET status = 'settled', settled_at = ${now},
          settlement_note = 'settle-by-admin'
      WHERE status = 'redeemed' ${brandId ? sql`AND brand_id = ${brandId}` : sql``}
    `);
    return Response.json({ settled: result.meta.changes ?? 0 });
  } catch (e) {
    return handleRouteError(e);
  }
}
