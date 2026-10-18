import { handleRouteError, requireUser } from "@/lib/api";
import { cancelBooking } from "@/lib/services/booking";

export async function POST(req: Request, ctx: { params: Promise<{ idOrCode: string }> }) {
  try {
    const user = await requireUser(req);
    const { idOrCode } = await ctx.params;
    const result = await cancelBooking(user.id, idOrCode);
    return Response.json(result);
  } catch (e) {
    return handleRouteError(e);
  }
}
