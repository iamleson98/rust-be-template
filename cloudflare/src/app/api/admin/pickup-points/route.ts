import { getDb } from "@/lib/db/client";
import { pickupPoints } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson, err } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminPickupPointOut } from "@/lib/services/admin-out";

/** `GET /api/admin/pickup-points?routeId=` — a route's boarding points. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:pickup_points:read");
    const url = new URL(req.url);
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const db = await getDb();
    const rows = await db
      .select()
      .from(pickupPoints)
      .where(routeId ? eq(pickupPoints.routeId, routeId) : undefined)
      .orderBy(asc(pickupPoints.stopOrder));
    return Response.json({ items: rows.map(adminPickupPointOut) });
  } catch (e) {
    return handleRouteError(e);
  }
}

interface PpBody {
  routeId?: string;
  name?: string;
  address?: string;
  lat?: number;
  lon?: number;
  stopOrder?: number;
  kind?: string;
}

/** `POST /api/admin/pickup-points` — create a pickup/dropoff point. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:pickup_points:write");
    const body = await readJson<PpBody>(req);
    const routeId = (body.routeId ?? "").trim();
    if (!routeId) return err(400, "validation", "routeId is required");
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.insert(pickupPoints).values({
      id,
      routeId,
      name: body.name ?? null,
      address: body.address ?? null,
      lat: body.lat ?? null,
      lon: body.lon ?? null,
      stopOrder: body.stopOrder ?? 0,
      kind: body.kind ?? null,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
