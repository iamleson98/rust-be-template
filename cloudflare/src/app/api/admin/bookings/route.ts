import { staffRoute } from "@/lib/api";
import { adminListBookings, adminQueryOf } from "@/lib/services/admin-bookings";

/**
 * `GET /api/admin/bookings?status=&brandId=&routeId=&dateFrom=&dateTo=&search=&limit=&offset=&sort=`
 * — admin ticket list across every user (tickets only: no unfinished checkouts).
 */
export const GET = staffRoute("admin:bookings:read", async (req) => {
  return Response.json(await adminListBookings(adminQueryOf(new URL(req.url))));
});
