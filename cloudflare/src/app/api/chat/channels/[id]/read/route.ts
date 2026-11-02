import { handleRouteError, requireUser, type IdParams } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import { markRead } from "@/lib/services/chat";

/** `POST /api/chat/channels/{id}/read` — clear the caller's side of the unread counter. */
export async function POST(req: Request, ctx: IdParams) {
  try {
    const user = await requireUser(req);
    return Response.json(await markRead(user, uuidParam("id", (await ctx.params).id) as string));
  } catch (e) {
    return handleRouteError(e);
  }
}
