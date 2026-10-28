import { handleRouteError, requireStaff } from "@/lib/api";
import { onlineChannels } from "@/lib/services/chat";

/**
 * `GET /api/chat/channels/online` — staff only: the queue's channels with
 * recent activity plus the customer ids behind them (brand-scoped like the
 * channel list).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    return Response.json(await onlineChannels(staff));
  } catch (e) {
    return handleRouteError(e);
  }
}
