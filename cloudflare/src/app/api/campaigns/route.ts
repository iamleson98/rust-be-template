import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError } from "@/lib/api";

/**
 * `GET /api/campaigns` — public, live coupon campaigns (Rust
 * `PublicCampaignListResponse`): running windows, not paused, with their
 * brand scope and per-tier remaining slots.
 */
export async function GET() {
  try {
    const now = new Date().toISOString();
    const rows = await rawAll<{
      id: string;
      name: string;
      description: string | null;
      starts_at: string;
      ends_at: string;
      coupon_validity: string;
      all_brands: number;
    }>(sql`
      SELECT dc.id, dc.name, dc.description, dc.starts_at, dc.ends_at,
             dc.coupon_validity, dc.all_brands
      FROM discount_campaign dc
      WHERE dc.paused = 0
        AND dc.starts_at <= ${now}
        AND dc.ends_at >= ${now}
      ORDER BY dc.starts_at DESC
    `);
    if (!rows.length) return Response.json({ items: [], serverTime: now });

    const brands = await rawAll<{
      campaign_id: string;
      id: string;
      name: string;
      slug: string;
      logo_url: string | null;
    }>(sql`
      SELECT dcb.campaign_id, br.id, br.name, br.slug, br.logo_url
      FROM discount_campaign_brand dcb JOIN brand br ON br.id = dcb.brand_id
    `);
    const tiers = await rawAll<{
      campaign_id: string;
      id: string;
      amount: number;
      total_slots: number;
      claimed_slots: number;
    }>(sql`
      SELECT dt.campaign_id, dt.id, dt.amount, dt.total_slots, dt.claimed_slots
      FROM discount_tier dt ORDER BY dt.position ASC, dt.amount ASC
    `);

    const brandsBy = new Map<string, Array<{ id: string; name: string; slug: string; logoUrl: string | null }>>();
    for (const b of brands) {
      const list = brandsBy.get(b.campaign_id) ?? [];
      list.push({ id: b.id, name: b.name, slug: b.slug, logoUrl: b.logo_url });
      brandsBy.set(b.campaign_id, list);
    }
    const tiersBy = new Map<string, Array<{ id: string; amount: number; remaining: number; totalSlots: number }>>();
    for (const t of tiers) {
      const list = tiersBy.get(t.campaign_id) ?? [];
      list.push({
        id: t.id,
        amount: t.amount,
        remaining: Math.max(0, t.total_slots - t.claimed_slots),
        totalSlots: t.total_slots,
      });
      tiersBy.set(t.campaign_id, list);
    }

    return Response.json({
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        startsAt: c.starts_at,
        endsAt: c.ends_at,
        couponValidity: c.coupon_validity,
        allBrands: !!c.all_brands,
        brands: brandsBy.get(c.id) ?? [],
        tiers: tiersBy.get(c.id) ?? [],
      })),
      serverTime: now,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
