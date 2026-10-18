import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { presetCatalog } from "@/lib/services/admin-out";

/** `GET /api/admin/bus-layouts/presets` — the "create from template" catalog. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:read");
    return Response.json({ items: presetCatalog() });
  } catch (e) {
    return handleRouteError(e);
  }
}
