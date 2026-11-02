import { handleRouteError, readJson, requireStaff, staffRoute, type IdParams } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { uuidParam } from "@/lib/services/http-errors";
import { moderateReview, removeReview } from "@/lib/services/reviews";

/** `PATCH /api/admin/reviews/{id}` — set the status and/or the brand's reply. */
export async function PATCH(req: Request, ctx: IdParams) {
  try {
    const staff = await requireStaff(req);
    const id = uuidParam("id", (await ctx.params).id) as string;
    const body = await readJson<{ status?: string | null; brandReply?: string | null }>(req);
    await requirePermission(staff, "admin:reviews:moderate");
    return Response.json(await moderateReview(id, body));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/reviews/{id}` — remove any review (empty 200, as Rust). */
export const DELETE = staffRoute<IdParams>("admin:reviews:moderate", async (req, ctx) => {
  await removeReview(uuidParam("id", (await ctx.params).id) as string, null);
  return new Response(null, { status: 200 });
});
