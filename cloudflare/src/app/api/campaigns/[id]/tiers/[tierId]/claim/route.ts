import { rawAll, rawRun } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireUser, clientIp, err } from "@/lib/api";

type Params = { params: Promise<{ id: string; tierId: string }> };

/**
 * `POST /api/campaigns/{id}/tiers/{tier_id}/claim` — claim a coupon from a
 * running campaign tier (Rust semantics: customers only, one coupon per
 * account, one claim per campaign, slot-limited with conflict retry).
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    const { id, tierId } = await ctx.params;
    if (user.role === "admin" || user.role === "employee") {
      return err(403, "customers-only", "Staff accounts cannot claim campaign coupons");
    }

    const campaign = (
      await rawAll<{
        id: string;
        starts_at: string;
        ends_at: string;
        paused: number;
        coupon_validity: string;
      }>(sql`
        SELECT id, starts_at, ends_at, paused, coupon_validity
        FROM discount_campaign WHERE id = ${id} LIMIT 1
      `)
    )[0];
    if (!campaign) return err(404, "not-found", "campaign not found");
    const now = new Date();
    if (campaign.paused || now < new Date(campaign.starts_at) || now > new Date(campaign.ends_at)) {
      return err(400, "not-running", "campaign is not running");
    }

    // One coupon per account at a time.
    const holding = (
      await rawAll<{ id: string }>(sql`
        SELECT id FROM coupon WHERE user_id = ${user.id} AND status = 'held' LIMIT 1
      `)
    )[0];
    if (holding) return err(409, "already-held", "You are already holding a coupon");

    // One claim per campaign per account.
    const claimed = (
      await rawAll<{ id: string }>(sql`
        SELECT id FROM coupon WHERE user_id = ${user.id} AND campaign_id = ${id} LIMIT 1
      `)
    )[0];
    if (claimed) return err(409, "already-claimed", "You already claimed this campaign");

    // Slot claim: conditional UPDATE — atomically rejects a sold-out tier.
    const nowIso = now.toISOString();
    const ip = clientIp(req).slice(0, 64);
    const slot = await rawRun(sql`
      UPDATE discount_tier
      SET claimed_slots = claimed_slots + 1
      WHERE id = ${tierId} AND campaign_id = ${id} AND claimed_slots < total_slots
    `);
    if ((slot.meta.changes ?? 0) === 0) return err(410, "sold-out", "This reward tier is sold out");

    // valid_until: campaign window end, or +7 days for permanent coupons.
    const validUntil =
      campaign.coupon_validity === "permanent"
        ? new Date(now.getTime() + 7 * 86400_000).toISOString()
        : campaign.ends_at;

    const couponId = crypto.randomUUID();
    const code = `DXV-${now.getUTCFullYear().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
    await rawRun(sql`
      INSERT INTO coupon (id, code, campaign_id, tier_id, user_id, amount, status,
                          active_holder, valid_until, claim_ip, claimed_at, updated_at)
      VALUES (${couponId}, ${code}, ${id}, ${tierId}, ${user.id},
              (SELECT amount FROM discount_tier WHERE id = ${tierId}), 'held', ${user.id},
              ${validUntil}, ${ip}, ${nowIso}, ${nowIso})
    `);

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
    )[0]!;
    const split = (s: unknown) => (s ? String(s).split(",") : []);
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
