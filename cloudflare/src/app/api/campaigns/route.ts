import { handleRouteError } from "@/lib/api";
import { listPublicCampaigns } from "@/lib/services/lookups";

/**
 * `GET /api/campaigns` — public, live coupon campaigns (Rust
 * `PublicCampaignListResponse`): running windows, not paused, with their
 * brand scope and per-tier remaining slots. Cache-first (30s TTL,
 * invalidated by admin campaign writes); `serverTime` stays fresh.
 */
export async function GET() {
  try {
    const items = await listPublicCampaigns();
    return Response.json({ items, serverTime: new Date().toISOString() });
  } catch (e) {
    return handleRouteError(e);
  }
}
