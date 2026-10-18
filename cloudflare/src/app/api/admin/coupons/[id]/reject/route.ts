import { rawAll, rawRun } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

/**
 * `POST /api/admin/coupons/{id}/reject` — refuse to honour a redeemed
 * coupon (fraud / rule violation). Requires a reason; returns the
 * updated `CouponOut`.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const { id } = await ctx.params;
    const body = await readJson<{ reason?: string }>(req);
    const reason = (body.reason ?? "").trim();
    if (!reason) return err(400, "validation", "a rejection reason is required");
    const rows = await rawAll<{ id: string; status: string }>(
      sql`SELECT id, status FROM coupon WHERE id = ${id} LIMIT 1`,
    );
    if (!rows[0]) return err(404, "not-found", "coupon not found");
    if (rows[0].status !== "redeemed") {
      return err(409, "conflict", "only redeemed coupons can be rejected");
    }
    const now = new Date().toISOString();
    await rawRun(sql`
      UPDATE coupon SET status = 'rejected', settlement_note = ${reason}, updated_at = ${now}
      WHERE id = ${id}
    `);
    const out = (
      await rawAll<Record<string, unknown>>(sql`
        SELECT c.id, c.code, c.campaign_id, c.amount, c.status, c.claimed_at,
               c.valid_until, c.booking_id,
               (SELECT dc.name FROM discount_campaign dc WHERE dc.id = c.campaign_id) AS campaign_name,
               (SELECT dc.all_brands FROM discount_campaign dc WHERE dc.id = c.campaign_id) AS all_brands,
               (SELECT b.code FROM booking b WHERE b.id = c.booking_id) AS booking_code,
               (SELECT group_concat(dcb.brand_id) FROM discount_campaign_brand dcb WHERE dcb.campaign_id = c.campaign_id) AS brand_ids,
               (SELECT group_concat(br.name) FROM discount_campaign_brand dcb
                  JOIN brand br ON br.id = dcb.brand_id WHERE dcb.campaign_id = c.campaign_id) AS brand_names,
               (SELECT group_concat(br.slug) FROM discount_campaign_brand dcb
                  JOIN brand br ON br.id = dcb.brand_id WHERE dcb.campaign_id = c.campaign_id) AS brand_slugs,
               (SELECT group_concat(br.logo_url) FROM discount_campaign_brand dcb
                  JOIN brand br ON br.id = dcb.brand_id WHERE dcb.campaign_id = c.campaign_id) AS brand_logos
        FROM coupon c WHERE c.id = ${id} LIMIT 1
      `)
    )[0]!;
    const split = (s: unknown) => (s ? String(s).split(",") : []);
    return Response.json({
      id: out.id,
      code: out.code,
      campaignId: out.campaign_id,
      campaignName: out.campaign_name,
      amount: out.amount,
      status: out.status,
      validUntil: out.valid_until,
      bookingCode: out.booking_code,
      claimedAt: out.claimed_at,
      allBrands: !!out.all_brands,
      brands: split(out.brand_ids).map((bid, i) => ({
        id: bid,
        name: split(out.brand_names)[i] ?? "",
        slug: split(out.brand_slugs)[i] ?? "",
        logoUrl: split(out.brand_logos)[i] ?? null,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
