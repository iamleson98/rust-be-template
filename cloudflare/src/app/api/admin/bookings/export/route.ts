import { staffRoute } from "@/lib/api";
import { adminBookingExport, adminQueryOf } from "@/lib/services/admin-bookings";

/** `GET /api/admin/bookings/export` — CSV export of the filtered ticket list. */
export const GET = staffRoute("admin:export", async (req) => {
  return Response.json(await adminBookingExport(adminQueryOf(new URL(req.url))));
});
