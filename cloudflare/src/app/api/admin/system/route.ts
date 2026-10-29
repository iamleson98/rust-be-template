import { err, handleRouteError, requireStaff } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";
import { systemReport } from "@/lib/services/system-status";

/**
 * `GET /api/admin/system` — what runs the site: the Worker, D1, the cron
 * driver and the VPS service (place search, OSM index, CPU/memory/disk).
 * Admin only; never cached.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "admin access required");
    return Response.json(await systemReport(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return handleRouteError(e);
  }
}
