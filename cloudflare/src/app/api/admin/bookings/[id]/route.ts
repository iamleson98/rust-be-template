import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { adminGetBooking, adminUpdateBookingStatus } from "@/lib/services/admin-bookings";

/** `GET /api/admin/bookings/{id}` — admin booking detail. */
export const GET = staffRoute<IdParams>("admin:bookings:read", async (req, ctx) => {
  const { id } = await ctx.params;
  return Response.json(await adminGetBooking(id));
});

/**
 * `PATCH /api/admin/bookings/{id}` — confirm (after phoning the customer),
 * complete or cancel a ticket. Completed and cancelled tickets are final.
 */
export const PATCH = staffRoute<IdParams>("admin:bookings:write", async (req, ctx, staff) => {
  const { id } = await ctx.params;
  const body = await readJson<{ status: string; reason?: string | null }>(req);
  return Response.json(await adminUpdateBookingStatus(staff.id, id, body));
});
