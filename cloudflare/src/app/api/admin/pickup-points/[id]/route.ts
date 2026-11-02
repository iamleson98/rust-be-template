import { getDb } from "@/lib/db/client";
import { pickupPoints } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { err, readJson, staffRoute } from "@/lib/api";
import { updatePickupPoint } from "@/lib/services/admin-pickup-points";

type Params = { params: Promise<{ id: string }> };

/** `PUT /api/admin/pickup-points/{id}` — update a pickup point; fields left out keep their values. */
export const PUT = staffRoute<Params>("admin:pickup_points:write", async (req, ctx) => {
  const { id } = await ctx.params;
  return Response.json(await updatePickupPoint(id, await readJson(req)));
});

/** `DELETE /api/admin/pickup-points/{id}` — remove a pickup point. */
export const DELETE = staffRoute<Params>("admin:pickup_points:write", async (req, ctx) => {
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
});
