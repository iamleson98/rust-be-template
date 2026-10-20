import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBookingStats, adminQueryOf } from "@/lib/services/admin-bookings";

/**
 * `GET /api/admin/bookings/stats?status=&brandId=&routeId=&dateFrom=&dateTo=&search=`
 * — totals + per-day (Vietnam calendar) buckets for the tickets dashboard.
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:stats:read");
    return Response.json(await adminBookingStats(adminQueryOf(new URL(req.url))));
  } catch (e) {
    return handleRouteError(e);
  }
}
