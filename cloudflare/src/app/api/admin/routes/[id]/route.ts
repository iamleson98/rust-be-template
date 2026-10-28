import { getDb } from "@/lib/db/client";
import { invalidateRoutes } from "@/lib/services/lookups";
import { routes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { purgeRoute } from "@/lib/services/route-media";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

interface RouteBody {
  brandId?: string;
  name?: string;
  startLocationId?: string;
  endLocationId?: string;
  status?: string;
}

/** `PUT /api/admin/routes/{id}` — update a route. */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:routes:write");
    const { id } = await ctx.params;
    const body = await readJson<RouteBody>(req);
    const db = await getDb();
    const existing = (await db.select().from(routes).where(eq(routes.id, id)).limit(1))[0];
    if (!existing) return err(404, "not-found", "route not found");
    const start = body.startLocationId?.trim() || existing.startLocationId;
    const end = body.endLocationId?.trim() || existing.endLocationId;
    await db
      .update(routes)
      .set({
        brandId: body.brandId?.trim() || null,
        name: body.name?.trim() || existing.name,
        startLocationId: start,
        endLocationId: end,
        status: body.status ?? existing.status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(routes.id, id));
    await invalidateRoutes();
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/routes/{id}` — remove a route (cascades schedules/pickup points). */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:routes:write");
    const { id } = await ctx.params;
    const db = await getDb();
    const existing = (
      await db.select({ id: routes.id }).from(routes).where(eq(routes.id, id)).limit(1)
    )[0];
    if (!existing) return err(404, "not-found", "route not found");
    // Purge the gallery's objects BEFORE the row cascade makes their keys
    // unrecoverable; a storage hiccup must not block the deletion.
    await purgeRoute(id).catch((e: unknown) => console.warn("route-picture GC failed", e));
    await db.delete(routes).where(eq(routes.id, id));
    await invalidateRoutes();
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
