import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBookingExport, adminQueryOf } from "@/lib/services/admin-bookings";

/** `GET /api/admin/bookings/export` — CSV export of the filtered ticket list. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:export");
    return Response.json(await adminBookingExport(adminQueryOf(new URL(req.url))));
  } catch (e) {
    return handleRouteError(e);
  }
}
