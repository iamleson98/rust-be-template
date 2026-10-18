import { handleRouteError, requireStaff } from "@/lib/api";
import { claimChannel } from "@/lib/services/chat";
import { emitChatEvent } from "@/lib/services/chat-hub-bridge";

/** `POST /api/chat/channels/{id}/claim` — staff takes the channel. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await ctx.params;
    const channel = await claimChannel(staff, id);
    await emitChatEvent({
      type: "channel_assigned",
      channelId: id,
      employeeId: staff.id,
      employeeName: staff.fullName,
    });
    return Response.json({ ok: true, channel });
  } catch (e) {
    return handleRouteError(e);
  }
}
