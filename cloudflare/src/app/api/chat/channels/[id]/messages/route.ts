import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { listMessages, postMessage } from "@/lib/services/chat";
import { emitChatEvent } from "@/lib/services/chat-hub-bridge";

/** `GET /api/chat/channels/{id}/messages` — offset paging, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);
    const items = await listMessages(user, id, limit, offset);
    return Response.json({
      items: items.map((m) => ({
        id: m.id,
        channelId: m.channelId,
        senderType: m.senderType,
        senderId: m.senderId,
        content: m.content,
        kind: m.kind,
        attachments: m.attachments,
        createdAt: m.createdAt,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/chat/channels/{id}/messages` — send (idempotent per clientMsgId). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    await limitWrite("chat-message", user.id);
    const { id } = await ctx.params;
    const body = await readJson<{
      content?: string | null;
      kind?: string;
      clientMsgId?: string | null;
      attachments?: string | null;
    }>(req);
    const msg = await postMessage(user, id, body);
    // REST-sent messages fan out through the WS hub too (same frame shape
    // the hub itself emits, so clients render both paths identically).
    await emitChatEvent({
      type: "message",
      channelId: msg.channelId,
      id: msg.id,
      senderType: msg.senderType,
      senderId: msg.senderId,
      senderName: user.fullName,
      text: msg.content,
      clientMsgId: msg.clientMsgId,
      createdAt: msg.createdAt,
    });
    await emitChatEvent({ type: "channel_message", channelId: msg.channelId });
    return Response.json(
      {
        message: {
          id: msg.id,
          channelId: msg.channelId,
          senderType: msg.senderType,
          senderId: msg.senderId,
          content: msg.content,
          kind: msg.kind,
          attachments: msg.attachments,
          createdAt: msg.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
