import { handleRouteError, requireStaff } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/** `POST /api/admin/system/database/vacuum` — no-op on D1 (managed service). */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff))
      return Response.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        { status: 403 },
      );
    return Response.json({ beforeBytes: 0, afterBytes: 0, reclaimedBytes: 0, seconds: 0 });
  } catch (e) {
    return handleRouteError(e);
  }
}
