import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { listUsers } from "@/lib/services/users";
import { optionalCount } from "@/lib/services/pagination";

/**
 * `GET /api/users` — one page of users plus the total (`users:read`, staff only:
 * the list carries every customer's email, and since migration 0008 customers
 * no longer hold the permission either).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "users:read");
    const q = new URL(req.url).searchParams;
    const limit = Math.min(optionalCount(q, "limit") ?? 50, 200);
    return Response.json(await listUsers(limit, optionalCount(q, "offset") ?? 0));
  } catch (e) {
    return handleRouteError(e);
  }
}
