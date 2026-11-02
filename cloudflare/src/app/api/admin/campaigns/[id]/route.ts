import { adminRoute, err, readJson, type IdParams } from "@/lib/api";
import { campaignOut } from "@/lib/services/campaign-out";
import { deleteCampaign, updateCampaign } from "@/lib/services/admin";

/** `GET /api/admin/campaigns/{id}` — one campaign, full detail. */
export const GET = adminRoute<IdParams>(async (_req, { params }) => {
  const out = await campaignOut((await params).id);
  return out ? Response.json(out) : err(404, "not-found", "campaign not found");
});

/**
 * `PATCH /api/admin/campaigns/{id}` — edit a campaign within what its
 * claims allow (`services/admin/campaigns.ts`).
 */
export const PATCH = adminRoute<IdParams>(async (req, { params }) =>
  Response.json(await updateCampaign((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/campaigns/{id}` — remove a campaign (cascades tiers/brand links). */
export const DELETE = adminRoute<IdParams>(async (_req, { params }) =>
  Response.json(await deleteCampaign((await params).id)),
);
