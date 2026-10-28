import { handleRouteError, requireUser } from "@/lib/api";
import { onlineChannels } from "@/lib/services/chat";

/** `GET /api/chat/channels/online` — staff only: the customers connected now and their open channels. */
export async function GET(req: Request) {
  try {
    return Response.json(await onlineChannels(await requireUser(req)));
  } catch (e) {
    return handleRouteError(e);
  }
}
