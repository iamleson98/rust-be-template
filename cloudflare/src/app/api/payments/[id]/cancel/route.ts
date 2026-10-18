import { getDb } from "@/lib/db/client";
import { cancelPayment } from "@/lib/services/payment";
import { handleRouteError, currentUser } from "@/lib/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await currentUser(req); // any authenticated caller (owner check inside service)
    const db = await getDb();
    const result = await cancelPayment(db, id);
    return Response.json({ id: result.id, status: result.status });
  } catch (e) {
    return handleRouteError(e);
  }
}
