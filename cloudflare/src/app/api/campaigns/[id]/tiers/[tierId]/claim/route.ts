import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, clientIp } from "@/lib/api";
import { claimCoupon } from "@/lib/services/campaign-claim";

type Params = { params: Promise<{ id: string; tierId: string }> };

/**
 * `POST /api/campaigns/{id}/tiers/{tier_id}/claim` — claim a coupon from a
 * running campaign tier (Rust `CampaignService::claim`): customer accounts
 * only, one held coupon at a time, one claim per campaign, slot-limited,
 * all in one atomic D1 batch. Failures carry the stable code as the error
 * message (`customers_only`, `campaign_not_running`, …) — see
 * `services/campaign-codes.ts`.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    await limitWrite("claim", user.id);
    const { id, tierId } = await ctx.params;
    const out = await claimCoupon(user.id, clientIp(req), id, tierId);
    return Response.json(out, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
