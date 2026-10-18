import { rawAll, rawBatch } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";
import { campaignOut } from "@/lib/services/campaign-out";

/** `GET /api/admin/campaigns` — every campaign incl. not-yet-running (admin-only route guard). */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const rows = await rawAll<{ id: string }>(
      sql`SELECT id FROM discount_campaign ORDER BY created_at DESC`,
    );
    const items = await Promise.all(rows.map((r) => campaignOut(r.id)));
    return Response.json({ items });
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

/** `POST /api/admin/campaigns` — create a coupon campaign. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "Admin access required");
    const body = await readJson<CampaignBody>(req);
    if (!body.name?.trim()) return err(400, "validation", "name is required");
    if (!body.startsAt || !body.endsAt) return err(400, "validation", "start/end are required");
    if (!body.tiers?.length) return err(400, "validation", "at least one tier is required");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const stmts = [
      sql`
        INSERT INTO discount_campaign (id, name, description, starts_at, ends_at,
                                        coupon_validity, all_brands, paused, created_by,
                                        created_at, updated_at)
        VALUES (${id}, ${body.name.trim()}, NULL, ${body.startsAt}, ${body.endsAt},
                ${body.couponValidity === "permanent" ? "permanent" : "campaign"},
                ${body.allBrands ? 1 : 0}, ${body.paused ? 1 : 0}, ${staff.id}, ${now}, ${now})
      `,
    ];
    if (!body.allBrands && body.brandIds?.length) {
      for (const brandId of body.brandIds) {
        stmts.push(
          sql`INSERT INTO discount_campaign_brand (campaign_id, brand_id) VALUES (${id}, ${brandId})
              ON CONFLICT DO NOTHING`,
        );
      }
    }
    body.tiers.forEach((t, i) => {
      stmts.push(
        sql`
          INSERT INTO discount_tier (id, campaign_id, amount, total_slots, claimed_slots, position, created_at)
          VALUES (${t.id || crypto.randomUUID()}, ${id}, ${t.amount}, ${t.totalSlots}, 0, ${i}, ${now})
        `,
      );
    });
    await rawBatch(stmts);
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
