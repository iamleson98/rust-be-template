import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminGetBooking, adminUpdateBookingStatus } from "@/lib/services/admin-bookings";

type Params = { params: Promise<{ id: string }> };

/** `GET /api/admin/bookings/{id}` — admin booking detail. */
export async function GET(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:read");
    const { id } = await ctx.params;
    return Response.json(await adminGetBooking(id));
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * `PATCH /api/admin/bookings/{id}` — confirm (after phoning the customer),
 * complete or cancel a ticket. Completed and cancelled tickets are final.
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bookings:write");
    const { id } = await ctx.params;
    const body = await readJson<{ status: string; reason?: string | null }>(req);
    return Response.json(await adminUpdateBookingStatus(staff.id, id, body));
  } catch (e) {
    return handleRouteError(e);
  }
}
