import { getDb } from "@/lib/db/client";
import { vehicleTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

interface VtBody {
  code?: string;
  label?: string;
  totalSeats?: number;
  sortOrder?: number;
  status?: string;
}

/** `PUT /api/admin/vehicle-types/{id}` — update a vehicle type. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:vehicle_types:write");
    const { id } = await ctx.params;
    const body = await readJson<VtBody>(req);
    const db = await getDb();
    const existing = (
      await db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id)).limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "vehicle type not found");
    await db
      .update(vehicleTypes)
      .set({
        code: body.code?.trim() || existing.code,
        label: body.label?.trim() || existing.label,
        totalSeats: body.totalSeats ?? existing.totalSeats,
        sortOrder: body.sortOrder ?? existing.sortOrder,
        status: body.status ?? existing.status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(vehicleTypes.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/vehicle-types/{id}` — remove a vehicle type. */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:vehicle_types:write");
    const { id } = await ctx.params;
    const db = await getDb();
    const existing = (
      await db
        .select({ id: vehicleTypes.id })
        .from(vehicleTypes)
        .where(eq(vehicleTypes.id, id))
        .limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "vehicle type not found");
    await db.delete(vehicleTypes).where(eq(vehicleTypes.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
