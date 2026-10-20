import { rawAll, rawRun, atomicBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireUser, err } from "@/lib/api";
import { invalidateCampaigns } from "@/lib/services/campaign-public";

/**
 * `GET /api/coupons/mine` — the user's wallet (Rust `my_coupons`):
 * the one coupon the account holds (status `held`, or `reserved` while a
 * booking is using it — both keep `active_holder` set) plus every
 * campaign they claimed from. Stale held coupons are lazily expired
 * first, so a late nightly `coupons.expire` run never shows a dead
 * coupon as active.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    // Lazy expiry for THIS user (Rust `active_coupon` does the same).
    const now = new Date().toISOString();
    await rawRun(sql`
      UPDATE coupon SET status = 'expired', active_holder = NULL, updated_at = ${now}
      WHERE active_holder = ${user.id} AND status = 'held'
        AND valid_until IS NOT NULL AND valid_until <= ${now}
    `);

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

    // Held (or reserved-on-a-booking) — both keep active_holder set.
    const active = rows.find((r) => r.status === "held" || r.status === "reserved") ?? null;
    return Response.json({
      active: active ? couponOut(active) : null,
      claimedCampaignIds: [...new Set(rows.map((r) => r.campaign_id))],
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * `DELETE /api/coupons/mine` — give up the held coupon (Rust `give_up` /
 * `release_coupon`): it becomes `released` and its slot goes back to the
 * tier while the campaign still runs, so the account can claim from another
 * campaign. A coupon on a booking cannot be given up. 404
 * `no unused coupon to give up` when there is none.
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    const rows = await rawAll<{ id: string; tier_id: string; campaign_id: string }>(sql`
      SELECT id, tier_id, campaign_id FROM coupon
      WHERE active_holder = ${user.id} AND status = 'held'
      LIMIT 1
    `);
    const held = rows[0];
    if (!held) return err(404, "not_found", "no unused coupon to give up");
    const now = new Date().toISOString();
    // One atomic unit. The slot goes back first and only while the coupon is
    // still held, so a racing release can never return it twice; then the
    // coupon is released by the same condition.
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
    if (!released.meta.changes) return err(404, "not_found", "no unused coupon to give up");
    // A slot may be free again.
    await invalidateCampaigns();
    return Response.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
