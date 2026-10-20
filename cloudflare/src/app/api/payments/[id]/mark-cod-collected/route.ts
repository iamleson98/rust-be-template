import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { markCodCollected } from "@/lib/services/payment";

/** `POST /api/payments/{id}/mark-cod-collected` — staff: cash received, confirm the booking. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:write");
    const { id } = await ctx.params;
    const body = await readJson<{ amountCollected?: number | null; note?: string | null }>(
      req,
    ).catch(() => ({}));
    return Response.json(await markCodCollected(id, staff.id, body));
  } catch (e) {
    return handleRouteError(e);
  }
}
