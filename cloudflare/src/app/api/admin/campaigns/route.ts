import { adminRoute, readJson } from "@/lib/api";
import { adminCampaignList, createCampaign } from "@/lib/services/admin";

/** `GET /api/admin/campaigns` — every campaign incl. not-yet-running. */
export const GET = adminRoute(async () => Response.json(await adminCampaignList()));

/** `POST /api/admin/campaigns` — create a coupon campaign. */
export const POST = adminRoute(async (req, _ctx, admin) =>
  Response.json(await createCampaign(await readJson(req), admin.id), { status: 201 }),
);
