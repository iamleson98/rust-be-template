import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { ensureCustomerChannel, getChannelOut, listChannels } from "@/lib/services/chat";

/** `GET /api/chat/channels` — channels visible to the caller. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({ items: await listChannels(user) });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/chat/channels` — create-or-reuse the customer's open channel. */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<{ brandId?: string | null; topic?: string | null }>(req).catch(() => ({}) as { brandId?: string | null; topic?: string | null });
    const channel = await ensureCustomerChannel(user.id, body.brandId ?? undefined, body.topic ?? undefined);
    return Response.json({ channel: await getChannelOut(user, channel.id) }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
