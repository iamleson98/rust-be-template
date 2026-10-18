import { rawAll, rawBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireUser, err } from "@/lib/api";

/**
 * `GET /api/coupons/mine` — the user's wallet: the one ACTIVE coupon
 * (held, not yet redeemed/expired) plus every campaign they claimed from.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const rows = await rawAll<{
      id: string;
      code: string;
      campaign_id: string;
      campaign_name: string;
      amount: number;
      status: string;
      valid_until: string | null;
      booking_code: string | null;
      claimed_at: string;
      all_brands: number;
      brand_ids: string | null;
      brand_names: string | null;
      brand_slugs: string | null;
      brand_logos: string | null;
    }>(sql`
      SELECT c.id, c.code, c.campaign_id, dc.name AS campaign_name,
             c.amount, c.status, c.valid_until,
             (SELECT b.code FROM booking b WHERE b.id = c.booking_id) AS booking_code,
             c.claimed_at,
             dc.all_brands,
             (SELECT group_concat(dcb.brand_id) FROM discount_campaign_brand dcb
              WHERE dcb.campaign_id = c.campaign_id) AS brand_ids,
             (SELECT group_concat(br.name) FROM discount_campaign_brand dcb
              JOIN brand br ON br.id = dcb.brand_id
              WHERE dcb.campaign_id = c.campaign_id) AS brand_names,
             (SELECT group_concat(br.slug) FROM discount_campaign_brand dcb
              JOIN brand br ON br.id = dcb.brand_id
              WHERE dcb.campaign_id = c.campaign_id) AS brand_slugs,
             (SELECT group_concat(br.logo_url) FROM discount_campaign_brand dcb
              JOIN brand br ON br.id = dcb.brand_id
              WHERE dcb.campaign_id = c.campaign_id) AS brand_logos
      FROM coupon c
      JOIN discount_campaign dc ON dc.id = c.campaign_id
      WHERE c.user_id = ${user.id}
      ORDER BY c.claimed_at DESC
    `);

    const split = (s: string | null) => (s ? s.split(",") : []);
    const couponOut = (r: (typeof rows)[number]) => ({
      id: r.id,
      code: r.code,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      amount: r.amount,
      status: r.status,
      validUntil: r.valid_until,
      bookingCode: r.booking_code,
      claimedAt: r.claimed_at,
      allBrands: !!r.all_brands,
      brands: split(r.brand_ids).map((id, i) => ({
        id,
        name: split(r.brand_names)[i] ?? "",
        slug: split(r.brand_slugs)[i] ?? "",
        logoUrl: split(r.brand_logos)[i] ?? null,
      })),
    });

    const active = rows.find((r) => r.status === "held") ?? null;
    return Response.json({
      active: active ? couponOut(active) : null,
      claimedCampaignIds: [...new Set(rows.map((r) => r.campaign_id))],
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * `DELETE /api/coupons/mine` — give up the held coupon: frees the slot
 * (tier claimed_slots) and marks the coupon abandoned so the account can
 * claim again (Rust `couponsGiveUp`).
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    const rows = await rawAll<{ id: string; tier_id: string; status: string }>(sql`
      SELECT id, tier_id, status FROM coupon
      WHERE user_id = ${user.id} AND status = 'held'
      ORDER BY claimed_at DESC LIMIT 1
    `);
    const held = rows[0];
    if (!held) return err(409, "no-coupon", "No coupon held");
    const now = new Date().toISOString();
    await rawBatch([
      sql`UPDATE coupon SET status = 'expired', updated_at = ${now} WHERE id = ${held.id}`,
      sql`UPDATE discount_tier SET claimed_slots = MAX(claimed_slots - 1, 0) WHERE id = ${held.tier_id}`,
    ]);
    return Response.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
