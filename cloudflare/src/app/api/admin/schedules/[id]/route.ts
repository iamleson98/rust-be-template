import { getDb } from "@/lib/db/client";
import { schedules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { updateSchedule } from "@/lib/services/admin-schedules";

type Params = { params: Promise<{ id: string }> };

/** `PUT /api/admin/schedules/{id}` — update a schedule; `points` / `classFares` replace when present. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:write");
    const { id } = await ctx.params;
    return Response.json(await updateSchedule(id, await readJson(req)));
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/schedules/{id}` — remove a schedule (cascades points/fares). */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:write");
    const { id } = await ctx.params;
    const db = await getDb();
    const existing = (
      await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.id, id)).limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "schedule not found");
    await db.delete(schedules).where(eq(schedules.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
