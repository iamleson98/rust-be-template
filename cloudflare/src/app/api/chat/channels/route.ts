import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { ensureCustomerChannel, listChannels } from "@/lib/services/chat";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({ items: await listChannels(user) });
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await readJson<{ brandId?: string; topic?: string }>(req).catch(() => ({}))) as { brandId?: string; topic?: string };
    const channel = await ensureCustomerChannel(user.id, body.brandId, body.topic);
    return Response.json(
      {
        id: channel.id,
        status: channel.status,
        topic: channel.topic,
        createdAt: channel.createdAt,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
