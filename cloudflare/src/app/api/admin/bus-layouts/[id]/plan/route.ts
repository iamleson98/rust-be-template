import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBusLayoutDetail, syncSeatsForLayout, type SeatPlan } from "@/lib/services/admin-out";

type Params = { params: Promise<{ id: string }> };

/** `PUT /api/admin/bus-layouts/{id}/plan` — replace the whole floor plan. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:write");
    const { id } = await ctx.params;
    const detail = await adminBusLayoutDetail(id);
    if (!detail) return err(404, "not-found", "bus layout not found");
    const body = await readJson<{ plan: SeatPlan }>(req);
    if (!body.plan || !Array.isArray(body.plan.decks)) {
      return err(400, "validation", "plan.decks is required");
    }
    await syncSeatsForLayout(id, body.plan);
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
