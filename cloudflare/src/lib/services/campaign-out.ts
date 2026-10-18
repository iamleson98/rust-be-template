/**
 * Campaign serializers — the `AdminCampaignOut` / `PublicCampaignOut`
 * shapes the SPA SDK expects, assembled from the discount_campaign,
 * discount_campaign_brand, discount_tier and coupon tables.
 */
import { getDb } from "@/lib/db/client";
import {
  brands,
  coupons,
  discountCampaignBrands,
  discountCampaigns,
  discountTiers,
} from "@/lib/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

/** The `discount_campaign` row as drizzle selects it (snake_case source). */
export type CampaignRow = typeof discountCampaigns.$inferSelect;

/** `state` — derived from the window and the pause flag. */
function campaignState(c: CampaignRow, now: Date): string {
  if (c.paused) return "paused";
  if (now < new Date(c.startsAt)) return "scheduled";
  if (now > new Date(c.endsAt)) return "ended";
  return "running";
}

/** Coupon totals for one campaign — a single typed aggregate pass with
 * `COUNT(*) FILTER (WHERE …)` (SQLite 3.30+, D1 supports it). */
async function couponTotals(campaignId: string) {
  const db = await getDb();
  const rows = await db
    .select({
      claimed: sql<number>`COUNT(*)`,
      inUse: sql<number>`COUNT(*) FILTER (WHERE ${coupons.status} = 'held')`,
      redeemed: sql<number>`COUNT(*) FILTER (WHERE ${coupons.status} = 'redeemed')`,
      expiredCount: sql<number>`COUNT(*) FILTER (WHERE ${coupons.status} = 'expired')`,
      rejectedCount: sql<number>`COUNT(*) FILTER (WHERE ${coupons.status} = 'rejected')`,
      owedCount: sql<number>`COUNT(*) FILTER (WHERE ${coupons.status} = 'redeemed')`,
      owedAmount: sql<number>`COALESCE(SUM(${coupons.amount}) FILTER (WHERE ${coupons.status} = 'redeemed'), 0)`,
      paidCount: sql<number>`COUNT(*) FILTER (WHERE ${coupons.status} = 'settled')`,
      paidAmount: sql<number>`COALESCE(SUM(${coupons.amount}) FILTER (WHERE ${coupons.status} = 'settled'), 0)`,
    })
    .from(coupons)
    .where(eq(coupons.campaignId, campaignId));
  const t = rows[0];
  if (!t) {
    // Unreachable on a GROUP-less aggregate (SQL always returns one row);
    // made explicit so the compiler keeps the types honest.
    return {
      claimed: 0,
      inUse: 0,
      redeemed: 0,
      expiredCount: 0,
      rejectedCount: 0,
      owedCount: 0,
      owedAmount: 0,
      paidCount: 0,
      paidAmount: 0,
    };
  }
  return t;
}

/** `AdminCampaignOut` — full campaign with brands, tiers, totals. */
export async function campaignOut(id: string) {
  const db = await getDb();
  const c = (
    await db.select().from(discountCampaigns).where(eq(discountCampaigns.id, id)).limit(1)
  )[0];
  if (!c) return null;

  const brandRows = await db
    .select({ id: brands.id, name: brands.name, slug: brands.slug, logoUrl: brands.logoUrl })
    .from(discountCampaignBrands)
    .innerJoin(brands, eq(brands.id, discountCampaignBrands.brandId))
    .where(eq(discountCampaignBrands.campaignId, id))
    .orderBy(asc(brands.name));

  const tierRows = await db
    .select({
      id: discountTiers.id,
      amount: discountTiers.amount,
      totalSlots: discountTiers.totalSlots,
      claimedSlots: discountTiers.claimedSlots,
    })
    .from(discountTiers)
    .where(eq(discountTiers.campaignId, id))
    .orderBy(asc(discountTiers.position), asc(discountTiers.createdAt));

  const budgetRows = await db
    .select({
      budget: sql<number>`COALESCE(SUM(${discountTiers.totalSlots} * ${discountTiers.amount}), 0)`,
    })
    .from(discountTiers)
    .where(and(eq(discountTiers.campaignId, id)));
  const budget = budgetRows[0]?.budget ?? 0;

  const t = await couponTotals(id);

  return {
    id: c.id,
    name: c.name,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    couponValidity: c.couponValidity,
    allBrands: c.allBrands,
    brands: brandRows,
    paused: c.paused,
    state: campaignState(c, new Date()),
    tiers: tierRows,
    totals: {
      budget: Number(budget),
      claimed: Number(t.claimed),
      inUse: Number(t.inUse),
      expiredCount: Number(t.expiredCount),
      rejectedCount: Number(t.rejectedCount),
      owedCount: Number(t.owedCount),
      owedAmount: Number(t.owedAmount),
      paidCount: Number(t.paidCount),
      paidAmount: Number(t.paidAmount),
    },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}
