import { getDb } from "@/lib/db/client";
import { brands } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readJson, staffRoute } from "@/lib/api";
import { updateBrand } from "@/lib/services/admin-brands";

/** `PUT /api/admin/brands/{id}` — update a brand; fields left out keep their values. */
export const PUT = staffRoute<{ params: Promise<{ id: string }> }>(
  "admin:brands:write",
  async (req, ctx) => {
    const { id } = await ctx.params;
    return Response.json(await updateBrand(id, await readJson(req)));
  },
);

export const DELETE = staffRoute<{ params: Promise<{ id: string }> }>(
  "admin:brands:write",
  async (req, ctx) => {
    const { id } = await ctx.params;
    const db = await getDb();
    // Soft-delete: deactivate instead of removing (routes reference brands).
    await db
      .update(brands)
      .set({ status: "inactive", updatedAt: new Date().toISOString() })
      .where(eq(brands.id, id));
    return Response.json({ id, status: "inactive" });
  },
);
