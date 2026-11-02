import { staffRoute } from "@/lib/api";
import { adminBookingStats, adminQueryOf } from "@/lib/services/admin-bookings";

/**
 * `GET /api/admin/bookings/stats?status=&brandId=&routeId=&dateFrom=&dateTo=&search=`
 * — totals + per-day (Vietnam calendar) buckets for the tickets dashboard.
 */
export const GET = staffRoute("admin:stats:read", async (req) => {
  return Response.json(await adminBookingStats(adminQueryOf(new URL(req.url))));
});
