import { getDb } from "@/lib/db/client";
import { pickupPoints } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminPickupPointOut } from "@/lib/services/admin-out";
import { createPickupPoint } from "@/lib/services/admin-pickup-points";

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

/** `POST /api/admin/pickup-points` — create a pickup/dropoff point. */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:pickup_points:write");
    return Response.json(await createPickupPoint(await readJson(req)), { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
