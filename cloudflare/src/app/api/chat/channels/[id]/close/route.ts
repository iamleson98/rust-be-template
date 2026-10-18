import { handleRouteError, requireUser } from "@/lib/api";
import { closeChannel } from "@/lib/services/chat";
import { emitChatEvent } from "@/lib/services/chat-hub-bridge";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const channel = await closeChannel(user, id);
    await emitChatEvent({ type: "channel_closed", channelId: id });
    return Response.json({ ok: true, channel });
  } catch (e) {
    return handleRouteError(e);
  }
}
