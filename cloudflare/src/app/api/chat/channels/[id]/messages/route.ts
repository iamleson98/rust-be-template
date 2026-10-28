import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { intParam, uuidParam } from "@/lib/services/http-errors";
import { listMessages, postMessage, type PostMessageBody } from "@/lib/services/chat";

type Params = { params: Promise<{ id: string }> };

/** `GET /api/chat/channels/{id}/messages` — offset paging, newest first. */
export async function GET(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    const id = uuidParam("id", (await ctx.params).id) as string;
    const q = new URL(req.url).searchParams;
    return Response.json({
      items: await listMessages(
        user,
        id,
        intParam("limit", q.get("limit"), 30),
        intParam("offset", q.get("offset"), 0),
      ),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/chat/channels/{id}/messages` — send (idempotent per `clientMsgId`). */
export async function POST(req: Request, ctx: Params) {
  try {
    const user = await requireUser(req);
    await limitWrite("chat-message", user.id);
    const id = uuidParam("id", (await ctx.params).id) as string;
    const message = await postMessage(user, id, await readJson<PostMessageBody>(req));
    return Response.json({ message }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
