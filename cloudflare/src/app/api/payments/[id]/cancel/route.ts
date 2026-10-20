import { handleRouteError, currentUser, readJson } from "@/lib/api";
import { cancelPayment } from "@/lib/services/payment";

/** `POST /api/payments/{id}/cancel` — cancel a pending payment (the booking stays). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser(req);
    const body = await readJson<{ reason?: string | null }>(req).catch(() => ({
      reason: undefined as string | null | undefined,
    }));
    return Response.json(await cancelPayment(id, user?.id ?? null, body.reason));
  } catch (e) {
    return handleRouteError(e);
  }
}
