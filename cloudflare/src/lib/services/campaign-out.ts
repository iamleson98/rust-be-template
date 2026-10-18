/**
 * Campaign serializers — the `AdminCampaignOut` / `PublicCampaignOut`
 * shapes the SPA SDK expects, assembled from the discount_campaign,
 * discount_campaign_brand, discount_tier and coupon tables.
 */
import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  coupon_validity: string;
  all_brands: number;
  paused: number;
  created_at: string;
  updated_at: string;
}

/** `state` — derived from the window and the pause flag. */
function campaignState(c: CampaignRow, now: Date): string {
  if (c.paused) return "paused";
  if (now < new Date(c.starts_at)) return "scheduled";
  if (now > new Date(c.ends_at)) return "ended";
  return "running";
}

/** `AdminCampaignOut` — full campaign with brands, tiers, totals. */
export async function campaignOut(id: string) {
  const rows = await rawAll<CampaignRow>(sql`
    SELECT id, name, description, starts_at, ends_at, coupon_validity,
           all_brands, paused, created_at, updated_at
    FROM discount_campaign WHERE id = ${id} LIMIT 1
  `);
  const c = rows[0];
  if (!c) return null;

  const brandRows = await rawAll<{ id: string; name: string; slug: string; logo_url: string | null }>(sql`
    SELECT b.id, b.name, b.slug, b.logo_url
    FROM discount_campaign_brand dcb JOIN brand b ON b.id = dcb.brand_id
    WHERE dcb.campaign_id = ${id}
    ORDER BY b.name
  `);
  const tierRows = await rawAll<{
    id: string;
    amount: number;
    total_slots: number;
    claimed_slots: number;
  }>(sql`
    SELECT id, amount, total_slots, claimed_slots
    FROM discount_tier WHERE campaign_id = ${id} ORDER BY position, created_at
  `);
  const totals = await rawAll<{
    budget: number;
    claimed: number;
    in_use: number;
    redeemed: number;
    expired_count: number;
    rejected_count: number;
    owed_count: number;
    owed_amount: number;
    paid_count: number;
    paid_amount: number;
  }>(sql`
    SELECT
      (SELECT COALESCE(SUM(t.total_slots * t.amount), 0) FROM discount_tier t WHERE t.campaign_id = ${id}) AS budget,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id}) AS claimed,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'held') AS in_use,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'redeemed') AS redeemed,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'expired') AS expired_count,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'rejected') AS rejected_count,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'redeemed') AS owed_count,
      (SELECT COALESCE(SUM(c.amount), 0) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'redeemed') AS owed_amount,
      (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'settled') AS paid_count,
      (SELECT COALESCE(SUM(c.amount), 0) FROM coupon c WHERE c.campaign_id = ${id} AND c.status = 'settled') AS paid_amount
  `);
  const t = totals[0]!;

  return {
    id: c.id,
    name: c.name,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    couponValidity: c.coupon_validity,
    allBrands: !!c.all_brands,
    brands: brandRows.map((b) => ({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url })),
    paused: !!c.paused,
    state: campaignState(c, new Date()),
    tiers: tierRows.map((tr) => ({
      id: tr.id,
      amount: tr.amount,
      totalSlots: tr.total_slots,
      claimedSlots: tr.claimed_slots,
    })),
    totals: {
      budget: Number(t.budget),
      claimed: Number(t.claimed),
      inUse: Number(t.in_use),
      expiredCount: Number(t.expired_count),
      rejectedCount: Number(t.rejected_count),
      owedCount: Number(t.owed_count),
      owedAmount: Number(t.owed_amount),
      paidCount: Number(t.paid_count),
      paidAmount: Number(t.paid_amount),
    },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export type { CampaignRow };
