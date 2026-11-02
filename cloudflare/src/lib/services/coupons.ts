/**
 * Coupons as customers and staff see them, and the customer's wallet
 * (`GET` / `DELETE /api/coupons/mine`).
 *
 * One read model serves every coupon answer. A campaign's brands come back as
 * one JSON array, not as comma-joined columns split apart again: a brand
 * name with a comma in it used to shift every later name onto the wrong id.
 */
import { sql, type SQL } from "drizzle-orm";
import { atomicBatch, rawAll, rawRun } from "@/lib/db/client";
import { invalidateCampaigns } from "./campaign-public";
import { notFound } from "./http-errors";

interface CouponRow {
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
  brands: string;
}

export interface CouponView {
  id: string;
  code: string;
  campaignId: string;
  campaignName: string;
  amount: number;
  status: string;
  validUntil: string | null;
  bookingCode: string | null;
  claimedAt: string;
  allBrands: boolean;
  brands: { id: string; name: string; slug: string; logoUrl: string | null }[];
}

/** The coupons matching `where` (over `coupon c`), newest claim first. */
export async function couponViews(where: SQL): Promise<CouponView[]> {
  const rows = await rawAll<CouponRow>(sql`
    SELECT c.id, c.code, c.campaign_id, dc.name AS campaign_name, c.amount, c.status,
           c.valid_until, b.code AS booking_code, c.claimed_at, dc.all_brands,
           (SELECT json_group_array(json_object('id', br.id, 'name', br.name,
                                                'slug', br.slug, 'logoUrl', br.logo_url))
              FROM discount_campaign_brand dcb JOIN brand br ON br.id = dcb.brand_id
             WHERE dcb.campaign_id = c.campaign_id) AS brands
      FROM coupon c
      JOIN discount_campaign dc ON dc.id = c.campaign_id
      LEFT JOIN booking b ON b.id = c.booking_id
     WHERE ${where}
     ORDER BY c.claimed_at DESC
  `);
  return rows.map((r) => ({
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
    brands: JSON.parse(r.brands || "[]") as CouponView["brands"],
  }));
}

/**
 * The wallet: the one coupon the account holds (`held`, or `reserved` while
 * a booking uses it; both keep `active_holder` set) and every campaign it
 * claimed from. Its stale held coupons expire first, so a late nightly
 * `coupons.expire` never shows a dead coupon as active.
 */
export async function couponWallet(userId: string) {
  const now = new Date().toISOString();
  await rawRun(sql`
    UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
     WHERE active_holder = ${userId} AND status = 'held'
       AND valid_until IS NOT NULL AND valid_until <= ${now}
  `);
  const mine = await couponViews(sql`c.user_id = ${userId}`);
  return {
    active: mine.find((c) => c.status === "held" || c.status === "reserved") ?? null,
    claimedCampaignIds: [...new Set(mine.map((c) => c.campaignId))],
  };
}

/**
 * Give up the held coupon: it becomes `released`, and its slot goes back to
 * the tier while the campaign still runs. A coupon on a booking cannot be
 * given up. One atomic unit: the slot returns only while the coupon is still
 * held, so a racing release can never return it twice.
 */
export async function giveUpCoupon(userId: string): Promise<{ ok: true }> {
  const [held] = await rawAll<{ id: string; tier_id: string; campaign_id: string }>(sql`
    SELECT id, tier_id, campaign_id FROM coupon
     WHERE active_holder = ${userId} AND status = 'held' LIMIT 1
  `);
  if (!held) throw notFound("no unused coupon to give up");
  const now = new Date().toISOString();
  const [, released] = await atomicBatch([
    sql`
      UPDATE discount_tier SET claimed_slots = claimed_slots - 1
       WHERE id = ${held.tier_id} AND claimed_slots > 0
         AND EXISTS (SELECT 1 FROM coupon WHERE id = ${held.id} AND status = 'held')
         AND EXISTS (SELECT 1 FROM discount_campaign dc
                      WHERE dc.id = ${held.campaign_id} AND dc.ends_at > ${now})
    `,
    sql`
      UPDATE coupon SET status = 'released', active_holder = NULL, updated_at = ${now}
       WHERE id = ${held.id} AND status = 'held'
    `,
  ]);
  if (!released.meta.changes) throw notFound("no unused coupon to give up");
  // A slot may be free again.
  await invalidateCampaigns();
  return { ok: true };
}
