import { getDb } from "@/lib/db/client";
import { pickupPoints } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { readJson, staffRoute } from "@/lib/api";
import { adminPickupPointOut } from "@/lib/services/admin-out";
import { createPickupPoint } from "@/lib/services/admin-pickup-points";

/** `GET /api/admin/pickup-points?routeId=` — a route's boarding points. */
export const GET = staffRoute("admin:pickup_points:read", async (req) => {
  const url = new URL(req.url);
  const routeId = url.searchParams.get("routeId") ?? undefined;
  const db = await getDb();
  const rows = await db
    .select()
    .from(pickupPoints)
    .where(routeId ? eq(pickupPoints.routeId, routeId) : undefined)
    .orderBy(asc(pickupPoints.stopOrder));
  return Response.json({ items: rows.map(adminPickupPointOut) });
});

/** `POST /api/admin/pickup-points` — create a pickup/dropoff point. */
export const POST = staffRoute("admin:pickup_points:write", async (req) => {
  return Response.json(await createPickupPoint(await readJson(req)), { status: 201 });
});
