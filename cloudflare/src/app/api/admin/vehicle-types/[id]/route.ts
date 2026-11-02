import { getDb } from "@/lib/db/client";
import { vehicleTypes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import {
  objectBody,
  optionalInt,
  optionalOneOf,
  requiredText,
  STATUSES,
} from "@/lib/services/input";

type Params = { params: Promise<{ id: string }> };

/** `PUT /api/admin/vehicle-types/{id}` — update a vehicle type. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:vehicle_types:write");
    const { id } = await ctx.params;
    const body = objectBody(await readJson(req));
    const set = {
      code: requiredText(body, "code", 32),
      label: requiredText(body, "label", 100),
      totalSeats: optionalInt(body, "totalSeats", 1, 100),
      sortOrder: optionalInt(body, "sortOrder", -1000, 1000) ?? undefined,
      status: optionalOneOf(body, "status", STATUSES),
    };
    const db = await getDb();
    const updated = await db
      .update(vehicleTypes)
      .set({ ...set, updatedAt: new Date().toISOString() })
      .where(eq(vehicleTypes.id, id))
      .returning({ id: vehicleTypes.id });
    if (updated.length === 0) return err(404, "not-found", "vehicle type not found");
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
