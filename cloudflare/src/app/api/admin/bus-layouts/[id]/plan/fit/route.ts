import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBusLayoutDetail, findPreset } from "@/lib/services/admin-out";
import { fitToSeats, layoutSeats } from "@/lib/services/seat-plan";

type Params = { params: Promise<{ id: string }> };

/**
 * `POST /api/admin/bus-layouts/{id}/plan/fit` — lay a catalog template
 * over the layout's existing seats and return the result for review —
 * NOTHING IS SAVED (Rust `fit_bus_layout_plan`). The template decides
 * where each seat sits; the seats keep their identity (id and label).
 * Send the result to `PUT …/plan` to apply it. 400 when the template
 * cannot hold exactly these seats.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:read");
    const { id } = await ctx.params;
    const detail = await adminBusLayoutDetail(id);
    if (!detail) return err(404, "not-found", "bus layout not found");
    const body = await readJson<{ presetId: string }>(req);
    const preset = findPreset(body.presetId ?? "");
    if (!preset) return err(404, "not-found", `preset '${body.presetId}' not found`);
    const seatRows = await layoutSeats(id);
    try {
      const fitted = fitToSeats(preset.plan, seatRows);
      return Response.json(fitted);
    } catch (e) {
      return err(
        400,
        "validation",
        `template does not fit: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } catch (e) {
    return handleRouteError(e);
  }
}
