import { limitWrite } from "@/lib/rate-limit";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { intParam, uuidParam } from "@/lib/services/http-errors";
import { createChannel, listChannels, type CreateChannelBody } from "@/lib/services/chat";
import { badRequest } from "@/lib/services/http-errors";

/** `GET /api/chat/channels` — the caller's channels, or the staff queue. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const q = new URL(req.url).searchParams;
    return Response.json({
      items: await listChannels(
        user,
        intParam("limit", q.get("limit"), 50),
        intParam("offset", q.get("offset"), 0),
      ),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/chat/channels` — open a support channel, or return the customer's open one. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await limitWrite("chat-channel", user.id);
    const body = await readJson<CreateChannelBody>(req);
    if (body.topic != null && (typeof body.topic !== "string" || [...body.topic].length > 255))
      throw badRequest("topic has an invalid length");
    if (body.brandId != null) uuidParam("brandId", String(body.brandId));
    return Response.json({ channel: await createChannel(user, body) }, { status: 200 });
  } catch (e) {
    return handleRouteError(e);
  }
}
