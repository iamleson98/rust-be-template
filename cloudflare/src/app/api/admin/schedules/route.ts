import { getDb } from "@/lib/db/client";
import { schedules, schedulePoints, scheduleFares } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminScheduleList } from "@/lib/services/admin-out";

/** `GET /api/admin/schedules?routeId=` — a route's schedules with fares + points. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:read");
    const url = new URL(req.url);
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const items = await adminScheduleList(routeId);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}

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

/** `POST /api/admin/schedules` — create a schedule (with optional points/fares). */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:write");
    const body = await readJson<ScheduleBody>(req);
    const routeId = (body.routeId ?? "").trim();
    const departureTime = (body.departureTime ?? "").trim();
    if (!routeId || !/^\d{2}:\d{2}$/.test(departureTime)) {
      return err(400, "validation", "routeId and departureTime (HH:MM) are required");
    }
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(schedules).values({
      id,
      routeId,
      departureTime,
      effectiveFrom: body.effectiveFrom ?? null,
      effectiveTo: body.effectiveTo ?? null,
      daysOfWeek: body.daysOfWeek ?? "[]",
      busLayoutId: body.busLayoutId?.trim() || null,
      basePriceAdult: body.basePriceAdult ?? 0,
      basePriceChild: body.basePriceChild ?? null,
      amenities: body.amenities ?? "[]",
      vehicleTypeId: body.vehicleTypeId?.trim() || null,
      createdAt: now,
    });
    if (body.points && body.points.length >= 2) {
      await writePoints(db, id, body.points);
    }
    if (body.classFares) {
      await writeFares(db, id, body.classFares);
    }
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}

type Db = Awaited<ReturnType<typeof getDb>>;

async function writePoints(db: Db, scheduleId: string, points: Array<{ addressId?: string | null; arrivalTime?: string | null }>) {
  await db.delete(schedulePoints).where(eq(schedulePoints.scheduleId, scheduleId));
  const rows = points
    .map((p, i) => ({
      id: crypto.randomUUID(),
      scheduleId,
      addressId: (p.addressId ?? "").trim(),
      stopOrder: i + 1,
      kind: i === 0 ? "departure" : i === points.length - 1 ? "destination" : "intermediate",
      arrivalTime: p.arrivalTime ?? null,
      createdAt: new Date().toISOString(),
    }))
    .filter((r) => r.addressId.length > 0);
  if (rows.length >= 2) {
    for (let i = 0; i < rows.length; i += 40) {
      await db.insert(schedulePoints).values(rows.slice(i, i + 40));
    }
  }
}

async function writeFares(db: Db, scheduleId: string, fares: Array<{ seatClass: string; priceAdult: number; priceChild?: number | null }>) {
  await db.delete(scheduleFares).where(eq(scheduleFares.scheduleId, scheduleId));
  const rows = fares
    .filter((f) => f.seatClass && f.seatClass !== "standard")
    .map((f) => ({
      id: crypto.randomUUID(),
      scheduleId,
      seatClass: f.seatClass,
      priceAdult: f.priceAdult ?? 0,
      priceChild: f.priceChild ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 40) {
      await db.insert(scheduleFares).values(rows.slice(i, i + 40));
    }
  }
}
