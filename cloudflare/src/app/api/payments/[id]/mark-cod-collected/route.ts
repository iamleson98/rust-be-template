import { getDb } from "@/lib/db/client";
import { markCodCollected } from "@/lib/services/payment";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:payments:write");
    const { id } = await ctx.params;
    const db = await getDb();
    const result = await markCodCollected(db, id, staff.id);
    return Response.json({
      id: result.id,
      status: result.status,
      collectedAt: result.collectedAt,
      bookingConfirmed: true,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
