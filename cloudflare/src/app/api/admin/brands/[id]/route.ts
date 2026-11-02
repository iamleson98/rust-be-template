import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { updateBrand } from "@/lib/services/admin-brands";

/** `PUT /api/admin/brands/{id}` — update a brand; fields left out keep their values. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:write");
    const { id } = await ctx.params;
    return Response.json(await updateBrand(id, await readJson(req)));
  } catch (e) {
    return handleRouteError(e);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:write");
    const { id } = await ctx.params;
    const db = await getDb();
    // Soft-delete: deactivate instead of removing (routes reference brands).
    await db
      .update(brands)
      .set({ status: "inactive", updatedAt: new Date().toISOString() })
      .where(eq(brands.id, id));
    return Response.json({ id, status: "inactive" });
  } catch (e) {
    return handleRouteError(e);
  }
}
