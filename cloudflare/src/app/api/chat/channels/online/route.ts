import { handleRouteError } from "@/lib/api";
import { onlineChannels } from "@/lib/services/chat";

/**
 * `GET /api/chat/channels/online` — channels with recent activity plus the
 * customer ids behind them (the WS hub's snapshot equivalent).
 */
export async function GET() {
  try {
    return Response.json(await onlineChannels());
  } catch (e) {
    return handleRouteError(e);
  }
}
