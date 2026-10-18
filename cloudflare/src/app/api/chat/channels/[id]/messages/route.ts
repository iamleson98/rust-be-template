import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { listMessages, postMessage } from "@/lib/services/chat";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 200);
    const before = url.searchParams.get("before") ?? undefined;
    const items = await listMessages(user, id, limit, before);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const body = await readJson<{ text?: string; clientMsgId?: string; kind?: string }>(req);
    const msg = await postMessage(user, id, body);
    return Response.json(
      {
        id: msg.id,
        channelId: msg.channelId,
        senderType: msg.senderType,
        senderId: msg.senderId,
        content: msg.content,
        kind: msg.kind,
        clientMsgId: msg.clientMsgId,
        createdAt: msg.createdAt,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
