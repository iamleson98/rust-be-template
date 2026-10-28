import { handleRouteError, requireUser } from "@/lib/api";
import { uuidParam } from "@/lib/services/http-errors";
import { releaseChannel } from "@/lib/services/chat";

/** `POST /api/chat/channels/{id}/release` — an admin gives the channel back to the queue. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    return Response.json(
      await releaseChannel(user, uuidParam("id", (await ctx.params).id) as string),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
