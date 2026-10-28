import { handleRouteError, requireStaff, err } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/** `GET /api/admin/system/memory` — isolate memory snapshot (Workers). */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return err(403, "forbidden", "admin access required");
    return Response.json({
      collected: false,
      sweeperIntervalSecs: 0,
      snapshot: {},
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
