import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { ensureCustomerChannel } from "@/lib/services/chat";
import { mintChannelToken, realtimeConfig } from "@/lib/realtime";

/**
 * POST /api/realtime/token — mint a Cloudflare Realtime (RealtimeKit) join
 * token for a support channel. Creates the channel when the customer has
 * none open. When Realtime is disabled the response carries enabled:false
 * and the client falls back to REST polling.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{ channelId?: string; brandId?: string; topic?: string }>(
      req,
    ).catch(() => ({}) as { channelId?: string; brandId?: string; topic?: string });
    let channelId = body.channelId;
    if (!channelId) {
      const ch = await ensureCustomerChannel(user.id, body.brandId, body.topic);
      channelId = ch.id;
    }
    const cfg = await realtimeConfig();
    if (!cfg.enabled) {
      return Response.json({ enabled: false, channelId });
    }
    const join = await mintChannelToken(channelId, {
      id: user.id,
      fullName: user.fullName,
      role: user.role,
    });
    return Response.json({ ...join, channelId });
  } catch (e) {
    return handleRouteError(e);
  }
}
