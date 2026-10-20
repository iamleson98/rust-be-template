import { handleRouteError } from "@/lib/api";
import { publicCampaigns } from "@/lib/services/campaign-public";

/**
 * `GET /api/campaigns` — public coupon campaigns (Rust
 * `PublicCampaignListResponse`): every campaign that is not paused and has
 * not ended — running and upcoming — with brand scope and per-tier slots
 * left, biggest discount first. Served from the per-isolate copy / Workers
 * Cache API (see `campaign-public.ts`); ended campaigns are trimmed and
 * `serverTime` set on every read.
 */
export async function GET() {
  try {
    return Response.json(await publicCampaigns());
  } catch (e) {
    return handleRouteError(e);
  }
}
