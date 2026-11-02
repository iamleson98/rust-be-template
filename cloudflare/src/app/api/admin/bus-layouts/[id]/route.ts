import { getDb } from "@/lib/db/client";
import { busLayouts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { err, readJson, staffRoute } from "@/lib/api";
import { objectBody, optionalText, requiredText } from "@/lib/services/input";
import { adminBusLayoutDetail, type SeatPlan } from "@/lib/services/admin-out";

type Params = { params: Promise<{ id: string }> };

/** `GET /api/admin/bus-layouts/{id}` — full layout incl. the floor plan. */
export const GET = staffRoute<Params>("admin:bus_layouts:read", async (req, ctx) => {
  const { id } = await ctx.params;
  const detail = await adminBusLayoutDetail(id);
  if (!detail) return err(404, "not-found", "bus layout not found");
  return Response.json(detail);
});

/**
 * `PUT /api/admin/bus-layouts/{id}` — update the layout's name, brand and
 * vehicle type; a field left out keeps its value. The seat plan and the
 * seat count change only through `/plan`, which checks the plan and keeps
 * the seat rows in step with it.
 */
export const PUT = staffRoute<Params>("admin:bus_layouts:write", async (req, ctx) => {
  const { id } = await ctx.params;
  const body = objectBody(await readJson(req));
  const set = {
    name: requiredText(body, "name", 200),
    brandId: optionalText(body, "brandId", 64),
    vehicleType: optionalText(body, "vehicleType", 32),
  };
  const db = await getDb();
  const updated = await db
    .update(busLayouts)
    .set({ ...set, updatedAt: new Date().toISOString() })
    .where(eq(busLayouts.id, id))
    .returning({ id: busLayouts.id });
  if (updated.length === 0) return err(404, "not-found", "bus layout not found");
  return Response.json({ id });
});

/** `DELETE /api/admin/bus-layouts/{id}` — remove a layout (blocked while in use). */
export const DELETE = staffRoute<Params>("admin:bus_layouts:write", async (req, ctx) => {
  const { id } = await ctx.params;
  const detail = await adminBusLayoutDetail(id);
  if (!detail) return err(404, "not-found", "bus layout not found");
  if (detail.inUse) return err(409, "conflict", "layout is referenced by a schedule");
  const db = await getDb();
  await db.delete(busLayouts).where(eq(busLayouts.id, id));
  return Response.json({ id });
});

export type { SeatPlan };
