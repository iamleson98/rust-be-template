import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminListBookings, adminQueryOf } from "@/lib/services/admin-bookings";

/**
 * `GET /api/admin/bookings?status=&brandId=&routeId=&dateFrom=&dateTo=&search=&limit=&offset=&sort=`
 * — admin ticket list across every user (tickets only: no unfinished checkouts).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:read");
    return Response.json(await adminListBookings(adminQueryOf(new URL(req.url))));
  } catch (e) {
    return handleRouteError(e);
  }
}
