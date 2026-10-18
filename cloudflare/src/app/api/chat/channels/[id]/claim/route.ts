import { handleRouteError, requireStaff } from "@/lib/api";
import { claimChannel } from "@/lib/services/chat";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { id } = await ctx.params;
    return Response.json(await claimChannel(staff, id));
  } catch (e) {
    return handleRouteError(e);
  }
}
