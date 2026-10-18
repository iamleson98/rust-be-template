import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBusLayoutDetail, type SeatPlan } from "@/lib/services/admin-out";
import { replaceSeatPlan, InUseError } from "@/lib/services/seat-plan";

type Params = { params: Promise<{ id: string }> };

/**
 * `PUT /api/admin/bus-layouts/{id}/plan` — replace the whole floor plan
 * (Rust `replace_bus_layout_plan`): structural validation, the seat rows
 * keep their ids (matched by seatId, else by label), and while trips
 * sell the layout seats may only move or relabel — never appear or
 * disappear (409 with a human reason).
 */
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
    await replaceSeatPlan(id, body.plan);
    return Response.json({ id });
  } catch (e) {
    if (e instanceof InUseError) {
      return err(409, "conflict", e.message);
    }
    if (e instanceof Error && "statusCode" in e && (e as { statusCode?: number }).statusCode === 400) {
      return err(400, "validation", e.message);
    }
    return handleRouteError(e);
  }
}
