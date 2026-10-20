import { getDb, atomicBatch, type AtomicStatement } from "@/lib/db/client";
import { invalidateCampaigns } from "@/lib/services/campaign-public";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { discountCampaignBrands, discountCampaigns, discountTiers } from "@/lib/db/schema";
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
 * Every mutation is a typed drizzle statement inside one atomic batch.
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const { id } = await ctx.params;
    const body = await readJson<CampaignBody>(req);
    const db = await getDb();
    const existing = (
      await db
        .select({ id: discountCampaigns.id })
        .from(discountCampaigns)
        .where(eq(discountCampaigns.id, id))
        .limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "campaign not found");
    if (!body.name?.trim()) return err(400, "validation", "name is required");
    if (!body.startsAt || !body.endsAt) return err(400, "validation", "start/end are required");
    if (!body.tiers?.length) return err(400, "validation", "at least one tier is required");

    const now = new Date().toISOString();
    const stmts: AtomicStatement[] = [
      db
        .update(discountCampaigns)
        .set({
          name: body.name.trim(),
          startsAt: body.startsAt,
          endsAt: body.endsAt,
          couponValidity: body.couponValidity === "permanent" ? "permanent" : "campaign",
          allBrands: body.allBrands,
          paused: body.paused === true,
          updatedAt: now,
        })
        .where(eq(discountCampaigns.id, id)),
      db.delete(discountCampaignBrands).where(eq(discountCampaignBrands.campaignId, id)),
    ];
    if (!body.allBrands && body.brandIds?.length) {
      for (const brandId of body.brandIds) {
        stmts.push(
          db
            .insert(discountCampaignBrands)
            .values({ campaignId: id, brandId })
            .onConflictDoNothing(),
        );
      }
    }
    // Replace the tier set: keep counters for tiers sent with an id.
    // Tiers not in the payload are parked at position -1 then deleted.
    const keepIds = body.tiers
      .map((t) => t.id)
      .filter((tid): tid is string => typeof tid === "string");
    stmts.push(
      db
        .update(discountTiers)
        .set({ position: -1 })
        .where(
          and(
            eq(discountTiers.campaignId, id),
            keepIds.length > 0 ? notInArray(discountTiers.id, keepIds) : undefined,
          ),
        ),
    );
    for (const t of body.tiers) {
      if (t.id) {
        stmts.push(
          db
            .update(discountTiers)
            .set({
              amount: t.amount,
              // Never shrink below what customers already claimed.
              totalSlots: sql`MAX(${t.totalSlots}, ${discountTiers.claimedSlots})`,
            })
            .where(and(eq(discountTiers.id, t.id), eq(discountTiers.campaignId, id))),
        );
      } else {
        stmts.push(
          db.insert(discountTiers).values({
            id: crypto.randomUUID(),
            campaignId: id,
            amount: t.amount,
            totalSlots: t.totalSlots,
            claimedSlots: 0,
            position: 0,
            createdAt: now,
          }),
        );
      }
    }
    stmts.push(
      db
        .delete(discountTiers)
        .where(and(eq(discountTiers.campaignId, id), eq(discountTiers.position, -1))),
    );
    await atomicBatch(stmts);
    await invalidateCampaigns();
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
    const db = await getDb();
    const existing = (
      await db
        .select({ id: discountCampaigns.id })
        .from(discountCampaigns)
        .where(eq(discountCampaigns.id, id))
        .limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "campaign not found");
    await atomicBatch([db.delete(discountCampaigns).where(eq(discountCampaigns.id, id))]);
    await invalidateCampaigns();
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
