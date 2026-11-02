import { readJson, staffRoute } from "@/lib/api";
import { markCodCollected } from "@/lib/services/payment";

/** `POST /api/payments/{id}/mark-cod-collected` — staff: cash received, confirm the booking. */
export const POST = staffRoute<{ params: Promise<{ id: string }> }>(
  "admin:payments:write",
  async (req, ctx, staff) => {
    const { id } = await ctx.params;
    const body = await readJson<{ amountCollected?: number | null; note?: string | null }>(
      req,
    ).catch(() => ({}));
    return Response.json(await markCodCollected(id, staff.id, body));
  },
);
