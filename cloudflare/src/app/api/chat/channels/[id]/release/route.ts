import { handleRouteError, requireStaff } from "@/lib/api";
import { releaseChannel } from "@/lib/services/chat";
import { emitChatEvent } from "@/lib/services/chat-hub-bridge";

/** `POST /api/chat/channels/{id}/release` — staff gives the channel back to the queue. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await ctx.params;
    const channel = await releaseChannel(staff, id);
    await emitChatEvent({ type: "channel_released", channelId: id });
    return Response.json({ ok: true, channel });
  } catch (e) {
    return handleRouteError(e);
  }
}
