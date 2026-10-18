import { getDb } from "@/lib/db/client";
import { busLayouts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminBusLayoutDetail, type SeatPlan } from "@/lib/services/admin-out";

type Params = { params: Promise<{ id: string }> };

/** `GET /api/admin/bus-layouts/{id}` — full layout incl. the floor plan. */
export async function GET(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:read");
    const { id } = await ctx.params;
    const detail = await adminBusLayoutDetail(id);
    if (!detail) return err(404, "not-found", "bus layout not found");
    return Response.json(detail);
  } catch (e) {
    return handleRouteError(e);
  }
}

interface LayoutBody {
  brandId?: string;
  name?: string;
  vehicleType?: string;
  totalSeats?: number;
  layoutData?: string;
}

/** `PUT /api/admin/bus-layouts/{id}` — update layout metadata (plan via /plan). */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:write");
    const { id } = await ctx.params;
    const body = await readJson<LayoutBody>(req);
    const db = await getDb();
    const existing = (await db.select().from(busLayouts).where(eq(busLayouts.id, id)).limit(1))[0];
    if (!existing) return err(404, "not-found", "bus layout not found");
    await db
      .update(busLayouts)
      .set({
        brandId: body.brandId?.trim() || null,
        name: body.name?.trim() || existing.name,
        vehicleType: body.vehicleType ?? existing.vehicleType,
        totalSeats: body.totalSeats ?? existing.totalSeats,
        layoutData: body.layoutData ?? existing.layoutData,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(busLayouts.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `DELETE /api/admin/bus-layouts/{id}` — remove a layout (blocked while in use). */
export async function DELETE(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:bus_layouts:write");
    const { id } = await ctx.params;
    const detail = await adminBusLayoutDetail(id);
    if (!detail) return err(404, "not-found", "bus layout not found");
    if (detail.inUse) return err(409, "conflict", "layout is referenced by a schedule");
    const db = await getDb();
    await db.delete(busLayouts).where(eq(busLayouts.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}

export type { SeatPlan };
