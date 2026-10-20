import { limitWrite } from "@/lib/rate-limit";
import { getDb, rawAll } from "@/lib/db/client";
import { and, eq, sql } from "drizzle-orm";
import { coupons, discountCampaigns, discountTiers } from "@/lib/db/schema";
import { handleRouteError, requireUser, clientIp, err } from "@/lib/api";
import { invalidateCampaigns } from "@/lib/services/lookups";

type Params = { params: Promise<{ id: string; tierId: string }> };

/** A collision on the coupon code's unique index — regenerate and retry. */
function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(msg);
}

/**
 * `POST /api/campaigns/{id}/tiers/{tier_id}/claim` — claim a coupon from a
 * running campaign tier (Rust `CampaignService::claim` semantics:
 * customers only, one coupon per account at a time, one claim per
 * campaign, slot-limited with conflict compensation). The claimer's own
 * stale held coupons are expired first, so an expired window never locks
 * the account out until the nightly job runs.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    await limitWrite("claim", user.id);
    const { id, tierId } = await ctx.params;
    if (user.role === "admin" || user.role === "employee") {
      return err(403, "customers-only", "Staff accounts cannot claim campaign coupons");
    }
    const db = await getDb();

    // Lazy expiry of the caller's stale coupons (Rust runs this first,
    // inside the claim transaction).
    const now = new Date();
    const nowIso = now.toISOString();
    await db
      .update(coupons)
      .set({ status: "expired", activeHolder: null, updatedAt: nowIso })
      .where(
        and(
          eq(coupons.userId, user.id),
          eq(coupons.status, "held"),
          sql`${coupons.validUntil} IS NOT NULL AND ${coupons.validUntil} <= ${nowIso}`,
        ),
      );

    const campaign = (
      await db
        .select({
          id: discountCampaigns.id,
          startsAt: discountCampaigns.startsAt,
          endsAt: discountCampaigns.endsAt,
          paused: discountCampaigns.paused,
          couponValidity: discountCampaigns.couponValidity,
        })
        .from(discountCampaigns)
        .where(eq(discountCampaigns.id, id))
        .limit(1)
    )[0];
    if (!campaign) return err(404, "not-found", "campaign not found");
    if (campaign.paused || now < new Date(campaign.startsAt) || now > new Date(campaign.endsAt)) {
      return err(400, "not-running", "campaign is not running");
    }

    // One coupon per account at a time.
    const holding = (
      await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(and(eq(coupons.userId, user.id), eq(coupons.status, "held")))
        .limit(1)
    )[0];
    if (holding) return err(409, "already-held", "You are already holding a coupon");

    // One claim per campaign per account.
    const claimed = (
      await db
        .select({ id: coupons.id })
        .from(coupons)
        .where(and(eq(coupons.userId, user.id), eq(coupons.campaignId, id)))
        .limit(1)
    )[0];
    if (claimed) return err(409, "already-claimed", "You already claimed this campaign");

    // Slot claim: conditional UPDATE — atomically rejects a sold-out tier.
    const slot = await db
      .update(discountTiers)
      .set({ claimedSlots: sql`${discountTiers.claimedSlots} + 1` })
      .where(
        and(
          eq(discountTiers.id, tierId),
          eq(discountTiers.campaignId, id),
          sql`${discountTiers.claimedSlots} < ${discountTiers.totalSlots}`,
        ),
      );
    if ((slot.meta.changes ?? 0) === 0) return err(410, "sold-out", "This reward tier is sold out");

    // valid_until: campaign window end, or +7 days for permanent coupons.
    const validUntil =
      campaign.couponValidity === "permanent"
        ? new Date(now.getTime() + 7 * 86400_000).toISOString()
        : campaign.endsAt;

    const tier = (
      await db
        .select({ amount: discountTiers.amount })
        .from(discountTiers)
        .where(eq(discountTiers.id, tierId))
        .limit(1)
    )[0];

    const ip = clientIp(req).slice(0, 64);
    const couponId = crypto.randomUUID();

    // Insert with code-collision retry (the code column is UNIQUE); a
    // failed insert gives the slot back.
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const code = `DXV-${now.getUTCFullYear().toString(36).toUpperCase()}${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
      try {
        await db.insert(coupons).values({
          id: couponId,
          code,
          campaignId: id,
          tierId,
          userId: user.id,
          amount: tier?.amount ?? 0,
          status: "held",
          activeHolder: user.id,
          validUntil,
          claimIp: ip,
          claimedAt: nowIso,
          updatedAt: nowIso,
        });
        inserted = true;
      } catch (e) {
        if (!isUniqueViolation(e)) {
          await db
            .update(discountTiers)
            .set({ claimedSlots: sql`MAX(${discountTiers.claimedSlots} - 1, 0)` })
            .where(eq(discountTiers.id, tierId));
          throw e;
        }
        // code collision — regenerate (coupon id stays stable)
      }
    }
    if (!inserted) {
      await db
        .update(discountTiers)
        .set({ claimedSlots: sql`MAX(${discountTiers.claimedSlots} - 1, 0)` })
        .where(eq(discountTiers.id, tierId));
      return err(409, "try-again", "Claim conflict, please try again");
    }

    const out = (
      await rawAll<Record<string, unknown>>(sql`
        SELECT c.id, c.code, c.campaign_id, c.amount, c.status, c.valid_until, c.claimed_at,
               (SELECT dc.name FROM discount_campaign dc WHERE dc.id = c.campaign_id) AS campaign_name,
               (SELECT dc.all_brands FROM discount_campaign dc WHERE dc.id = c.campaign_id) AS all_brands,
               (SELECT dc.coupon_validity FROM discount_campaign dc WHERE dc.id = c.campaign_id) AS coupon_validity,
               (SELECT b.code FROM booking b WHERE b.id = c.booking_id) AS booking_code,
               (SELECT group_concat(dcb.brand_id) FROM discount_campaign_brand dcb WHERE dcb.campaign_id = c.campaign_id) AS brand_ids,
               (SELECT group_concat(br.name) FROM discount_campaign_brand dcb
                  JOIN brand br ON br.id = dcb.brand_id WHERE dcb.campaign_id = c.campaign_id) AS brand_names,
               (SELECT group_concat(br.slug) FROM discount_campaign_brand dcb
                  JOIN brand br ON br.id = dcb.brand_id WHERE dcb.campaign_id = c.campaign_id) AS brand_slugs,
               (SELECT group_concat(br.logo_url) FROM discount_campaign_brand dcb
                  JOIN brand br ON br.id = dcb.brand_id WHERE dcb.campaign_id = c.campaign_id) AS brand_logos
        FROM coupon c WHERE c.id = ${couponId} LIMIT 1
      `)
    )[0];
    const split = (s: unknown) => (s ? String(s).split(",") : []);
    // A claim shrinks every tier's remaining slots — drop the cached campaign list.
    await invalidateCampaigns();
    return Response.json(
      {
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
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
