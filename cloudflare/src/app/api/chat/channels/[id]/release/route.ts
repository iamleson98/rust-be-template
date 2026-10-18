import { handleRouteError, requireStaff } from "@/lib/api";
import { releaseChannel } from "@/lib/services/chat";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff(req);
    const { id } = await ctx.params;
    return Response.json(await releaseChannel(id));
  } catch (e) {
    return handleRouteError(e);
  }
}
