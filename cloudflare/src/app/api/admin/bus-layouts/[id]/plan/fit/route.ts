import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBusLayoutDetail, findPreset, syncSeatsForLayout } from "@/lib/services/admin-out";

type Params = { params: Promise<{ id: string }> };

/**
 * `POST /api/admin/bus-layouts/{id}/plan/fit` — fit a catalog template
 * (`sleeper_42`, `cabin_24`, …) onto the layout: replaces the plan and
 * regenerates the layout's `seat` rows.
 */
export async function POST(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:write");
    const { id } = await ctx.params;
    const detail = await adminBusLayoutDetail(id);
    if (!detail) return err(404, "not-found", "bus layout not found");
    const body = await readJson<{ presetId: string }>(req);
    const preset = findPreset(body.presetId ?? "");
    if (!preset) return err(404, "not-found", `preset '${body.presetId}' not found`);
    await syncSeatsForLayout(id, preset.plan);
    return Response.json(preset.plan);
  } catch (e) {
    return handleRouteError(e);
  }
}
