import { handleRouteError, requireUser } from "@/lib/api";
import { closeChannel } from "@/lib/services/chat";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    return Response.json(await closeChannel(user, id));
  } catch (e) {
    return handleRouteError(e);
  }
}
