import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { err, readJson, staffRoute } from "@/lib/api";
import { purgeRoute } from "@/lib/services/route-media";
import {
  objectBody,
  optionalOneOf,
  optionalText,
  requiredText,
  STATUSES,
} from "@/lib/services/input";

type Params = { params: Promise<{ id: string }> };

/** `PUT /api/admin/routes/{id}` — update a route; fields left out keep their values. */
export const PUT = staffRoute<Params>("admin:routes:write", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = objectBody(await readJson(req));
  const set = {
    // `null` detaches the route from its brand; absent keeps it.
    brandId: optionalText(body, "brandId", 64),
    name: requiredText(body, "name", 200),
    startLocationId: requiredText(body, "startLocationId", 64),
    endLocationId: requiredText(body, "endLocationId", 64),
    status: optionalOneOf(body, "status", STATUSES),
  };
  const db = await getDb();
  const updated = await db
    .update(routes)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(eq(routes.id, id))
    .returning({ id: routes.id });
  if (updated.length === 0) return err(404, "not-found", "route not found");
  return Response.json({ id });
});

/** `DELETE /api/admin/routes/{id}` — remove a route (cascades schedules/pickup points). */
export const DELETE = staffRoute<Params>("admin:routes:write", async (req, ctx) => {
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
  return Response.json({ id });
});
