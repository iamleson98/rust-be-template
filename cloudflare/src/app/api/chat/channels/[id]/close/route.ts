import { handleRouteError, requireUser } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import { closeChannel } from "@/lib/services/chat";

/** `POST /api/chat/channels/{id}/close` — staff closes the channel. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    return Response.json(await closeChannel(user, uuidParam("id", (await ctx.params).id) as string));
  } catch (e) {
    return handleRouteError(e);
  }
}
