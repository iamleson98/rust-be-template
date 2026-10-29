import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:brands:write");
    const { id } = await ctx.params;
    const body = await readJson<{
      name?: string;
      description?: string;
      contactPhone?: string;
      contactEmail?: string;
      /** `null` or `""` removes the logo; absent keeps it. */
      logoUrl?: string | null;
      status?: string;
      childMaxAge?: number;
      childDiscountAmount?: number;
    }>(req);
    const db = await getDb();
    const existing = (await db.select().from(brands).where(eq(brands.id, id)).limit(1))[0];
    if (!existing) return err(404, "not-found", "Brand not found");
    await db
      .update(brands)
      .set({
        name: body.name?.trim() ?? existing.name,
        description: body.description ?? existing.description,
        contactPhone: body.contactPhone ?? existing.contactPhone,
        contactEmail: body.contactEmail ?? existing.contactEmail,
        logoUrl: body.logoUrl === undefined ? existing.logoUrl : body.logoUrl || null,
        status: body.status ?? existing.status,
        childMaxAge: body.childMaxAge ?? existing.childMaxAge,
        childDiscountAmount: body.childDiscountAmount ?? existing.childDiscountAmount,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(brands.id, id));
    return Response.json({ id, updated: true });
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
