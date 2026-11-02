import { handleRouteError, requireUser, type IdParams } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import { claimChannel } from "@/lib/services/chat";

/** `POST /api/chat/channels/{id}/claim` — staff takes over the channel. */
export async function POST(req: Request, ctx: IdParams) {
  try {
    const user = await requireUser(req);
    return Response.json(
      await claimChannel(user, uuidParam("id", (await ctx.params).id) as string),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
