import { getDb } from "@/lib/db/client";
import { pickupPoints } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { updatePickupPoint } from "@/lib/services/admin-pickup-points";

type Params = { params: Promise<{ id: string }> };

/** `PUT /api/admin/pickup-points/{id}` — update a pickup point; fields left out keep their values. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:pickup_points:write");
    const { id } = await ctx.params;
    return Response.json(await updatePickupPoint(id, await readJson(req)));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/pickup-points/{id}` — remove a pickup point. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:pickup_points:write");
    const { id } = await ctx.params;
    const db = await getDb();
    const existing = (
      await db
        .select({ id: pickupPoints.id })
        .from(pickupPoints)
        .where(eq(pickupPoints.id, id))
        .limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "pickup point not found");
    await db.delete(pickupPoints).where(eq(pickupPoints.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
