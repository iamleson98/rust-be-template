import { getDb } from "@/lib/db/client";
import { pickupPoints } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

interface PpBody {
  routeId?: string;
  name?: string;
  address?: string;
  lat?: number;
  lon?: number;
  stopOrder?: number;
  kind?: string;
}

/** `PUT /api/admin/pickup-points/{id}` — update a pickup point. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:pickup_points:write");
    const { id } = await ctx.params;
    const body = await readJson<PpBody>(req);
    const db = await getDb();
    const existing = (
      await db.select().from(pickupPoints).where(eq(pickupPoints.id, id)).limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "pickup point not found");
    await db
      .update(pickupPoints)
      .set({
        routeId: body.routeId?.trim() || existing.routeId,
        name: body.name ?? existing.name,
        address: body.address ?? existing.address,
        lat: body.lat ?? existing.lat,
        lon: body.lon ?? existing.lon,
        stopOrder: body.stopOrder ?? existing.stopOrder,
        kind: body.kind ?? existing.kind,
      })
      .where(eq(pickupPoints.id, id));
    return Response.json({ id });
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
