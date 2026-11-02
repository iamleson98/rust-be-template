import { rawRun } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminRoute } from "@/lib/api";

/** Body: `{ brandId?: string }` — brand-scoped or everything outstanding. */
const SettleBody = z.object({ brandId: z.string().min(1).optional() });

/**
 * `POST /api/admin/coupons/settle` — mark redeemed coupons as settled
 * (paid out to the brand). Body: `{ brandId?: string }` — brand-scoped or
 * everything outstanding (Rust `SettleCouponsResponse`).
 */
export const POST = adminRoute(async (req) => {
  // Optional body: absent, empty or invalid JSON settles everything.
  const body: unknown = await req.json().catch(() => undefined);
  const parsed = SettleBody.safeParse(body);
  const brandId = parsed.success ? parsed.data.brandId : undefined;
  const now = new Date().toISOString();
  const result = await rawRun(sql`
    UPDATE coupon
    SET status = 'settled', settled_at = ${now},
        settlement_note = 'settle-by-admin'
    WHERE status = 'redeemed' ${brandId !== undefined ? sql`AND brand_id = ${brandId}` : sql``}
  `);
  return Response.json({ settled: result.meta.changes });
});
