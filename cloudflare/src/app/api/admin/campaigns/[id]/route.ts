import { rawAll, rawBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";
import { campaignOut } from "@/lib/services/campaign-out";

type Params = { params: Promise<{ id: string }> };

/** `GET /api/admin/campaigns/{id}` — one campaign, full detail. */
export async function GET(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const { id } = await ctx.params;
    const out = await campaignOut(id);
    if (!out) return err(404, "not-found", "campaign not found");
    return Response.json(out);
  } catch (e) {
    return handleRouteError(e);
  }
}

interface TierInput {
  id?: string | null;
  amount: number;
  totalSlots: number;
}

interface CampaignBody {
  name: string;
  startsAt: string;
  endsAt: string;
  couponValidity: string;
  allBrands: boolean;
  brandIds?: string[];
  paused?: boolean;
  tiers: TierInput[];
}

/**
 * `PATCH /api/admin/campaigns/{id}` — edit a campaign. Tiers keep their
 * claimed counters; `totalSlots` may grow but never below the claims.
 * Brand scope and window editable while no coupon has been redeemed.
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const { id } = await ctx.params;
    const body = await readJson<CampaignBody>(req);
    const existing = (
      await rawAll<{ id: string; claimed: number }>(sql`
        SELECT dc.id,
               (SELECT COUNT(*) FROM coupon c WHERE c.campaign_id = dc.id AND c.status != 'held') AS claimed
        FROM discount_campaign dc WHERE dc.id = ${id} LIMIT 1
      `)
    )[0];
    if (!existing) return err(404, "not-found", "campaign not found");
    if (!body.name?.trim()) return err(400, "validation", "name is required");
    if (!body.startsAt || !body.endsAt) return err(400, "validation", "start/end are required");
    if (!body.tiers?.length) return err(400, "validation", "at least one tier is required");

    const now = new Date().toISOString();
    const stmts = [
      sql`
        UPDATE discount_campaign
        SET name = ${body.name.trim()}, starts_at = ${body.startsAt}, ends_at = ${body.endsAt},
            coupon_validity = ${body.couponValidity === "permanent" ? "permanent" : "campaign"},
            all_brands = ${body.allBrands ? 1 : 0}, paused = ${body.paused ? 1 : 0},
            updated_at = ${now}
        WHERE id = ${id}
      `,
      sql`DELETE FROM discount_campaign_brand WHERE campaign_id = ${id}`,
    ];
    if (!body.allBrands && body.brandIds?.length) {
      for (const brandId of body.brandIds) {
        stmts.push(
          sql`INSERT INTO discount_campaign_brand (campaign_id, brand_id) VALUES (${id}, ${brandId})
              ON CONFLICT DO NOTHING`,
        );
      }
    }
    // Replace the tier set: keep counters for tiers sent with an id.
    const keepIds = body.tiers.filter((t) => t.id).map((t) => t.id as string);
    stmts.push(
      keepIds.length > 0
        ? sql`UPDATE discount_tier SET position = -1
              WHERE campaign_id = ${id} AND id NOT IN (${sql.join(keepIds.map((i) => sql`${i}`), sql`, `)})`
        : sql`UPDATE discount_tier SET position = -1 WHERE campaign_id = ${id}`,
    );
    for (const t of body.tiers) {
      if (t.id) {
        stmts.push(
          sql`UPDATE discount_tier
              SET amount = ${t.amount}, total_slots = MAX(${t.totalSlots}, claimed_slots)
              WHERE id = ${t.id} AND campaign_id = ${id}`,
        );
      } else {
        stmts.push(
          sql`INSERT INTO discount_tier (id, campaign_id, amount, total_slots, claimed_slots, position, created_at)
              VALUES (${crypto.randomUUID()}, ${id}, ${t.amount}, ${t.totalSlots}, 0, 0, ${now})`,
        );
      }
    }
    stmts.push(sql`DELETE FROM discount_tier WHERE campaign_id = ${id} AND position = -1`);
    await rawBatch(stmts);
    return Response.json(await campaignOut(id));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/campaigns/{id}` — remove a campaign (cascades tiers/brand links). */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const { id } = await ctx.params;
    const rows = await rawAll<{ id: string }>(
      sql`SELECT id FROM discount_campaign WHERE id = ${id} LIMIT 1`,
    );
    if (!rows[0]) return err(404, "not-found", "campaign not found");
    await rawBatch([sql`DELETE FROM discount_campaign WHERE id = ${id}`]);
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
