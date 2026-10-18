import { getDb } from "@/lib/db/client";
import { cancelPayment } from "@/lib/services/payment";
import { handleRouteError, currentUser } from "@/lib/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await currentUser(req); // any authenticated caller (owner check inside service)
    const db = await getDb();
    const result = await cancelPayment(db, id);
    return Response.json({
      paymentId: result.id,
      status: result.status,
      cancelledAt: result.updatedAt ?? new Date().toISOString(),
      reason: null,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
