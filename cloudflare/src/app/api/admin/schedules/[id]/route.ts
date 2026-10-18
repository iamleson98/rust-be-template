import { getDb } from "@/lib/db/client";
import { schedules, schedulePoints, scheduleFares } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ id: string }> };

interface ScheduleBody {
  routeId?: string;
  departureTime?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  daysOfWeek?: string;
  busLayoutId?: string;
  basePriceAdult?: number;
  basePriceChild?: number;
  amenities?: string;
  vehicleTypeId?: string;
  classFares?: Array<{ seatClass: string; priceAdult: number; priceChild?: number | null }> | null;
  points?: Array<{ addressId?: string | null; arrivalTime?: string | null }> | null;
}

/** `PUT /api/admin/schedules/{id}` — update a schedule (points/fares replace when present). */
export async function PUT(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:write");
    const { id } = await ctx.params;
    const body = await readJson<ScheduleBody>(req);
    const db = await getDb();
    const existing = (await db.select().from(schedules).where(eq(schedules.id, id)).limit(1))[0];
    if (!existing) return err(404, "not-found", "schedule not found");
    await db
      .update(schedules)
      .set({
        routeId: body.routeId?.trim() || existing.routeId,
        departureTime: body.departureTime?.trim() || existing.departureTime,
        effectiveFrom: body.effectiveFrom ?? existing.effectiveFrom,
        effectiveTo: body.effectiveTo ?? existing.effectiveTo,
        daysOfWeek: body.daysOfWeek ?? existing.daysOfWeek,
        busLayoutId: body.busLayoutId?.trim() || null,
        basePriceAdult: body.basePriceAdult ?? existing.basePriceAdult,
        basePriceChild: body.basePriceChild ?? existing.basePriceChild,
        amenities: body.amenities ?? existing.amenities,
        vehicleTypeId: body.vehicleTypeId?.trim() || null,
      })
      .where(eq(schedules.id, id));

    if (body.points && body.points.length >= 2) {
      await db.delete(schedulePoints).where(eq(schedulePoints.scheduleId, id));
      const rows = body.points
        .map((p, i) => ({
          id: crypto.randomUUID(),
          scheduleId: id,
          addressId: (p.addressId ?? "").trim(),
          stopOrder: i + 1,
          kind: i === 0 ? "departure" : i === body.points!.length - 1 ? "destination" : "intermediate",
          arrivalTime: p.arrivalTime ?? null,
          createdAt: new Date().toISOString(),
        }))
        .filter((r) => r.addressId.length > 0);
      for (let i = 0; i < rows.length; i += 40) {
        await db.insert(schedulePoints).values(rows.slice(i, i + 40));
      }
    }
    if (body.classFares) {
      await db.delete(scheduleFares).where(eq(scheduleFares.scheduleId, id));
      const rows = body.classFares
        .filter((f) => f.seatClass && f.seatClass !== "standard")
        .map((f) => ({
          id: crypto.randomUUID(),
          scheduleId: id,
          seatClass: f.seatClass,
          priceAdult: f.priceAdult ?? 0,
          priceChild: f.priceChild ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
      for (let i = 0; i < rows.length; i += 40) {
        await db.insert(scheduleFares).values(rows.slice(i, i + 40));
      }
    }
    return Response.json({ id });
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
    const existing = (await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.id, id)).limit(1))[0];
    if (!existing) return err(404, "not-found", "schedule not found");
    await db.delete(schedules).where(eq(schedules.id, id));
    return Response.json({ id });
  } catch (e) {
    return handleRouteError(e);
  }
}
