import { handleRouteError, requireStaff } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/** `GET /api/admin/system/memory` — isolate memory snapshot (Workers). */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff)) return Response.json({ error: { code: "forbidden", message: "Admin access required" } }, { status: 403 });
    return Response.json({
      collected: false,
      sweeperIntervalSecs: 0,
      snapshot: {},
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
