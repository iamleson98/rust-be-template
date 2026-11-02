/**
 * Admin pickup points — the output shape and the writes, `POST /api/admin/pickup-points` and
 * `PUT /api/admin/pickup-points/{id}`. A field left out of an update keeps
 * its value; coordinates are checked, so the geo search never reads a
 * string or an impossible point.
 */
import { pickupPoints, routes } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { badRequest, notFound } from "../http-errors";
import { objectBody, optionalCoords, optionalInt, optionalText, requiredText } from "../input";

export type PickupPointRow = typeof pickupPoints.$inferSelect;

export function adminPickupPointOut(p: PickupPointRow) {
  return {
    id: p.id,
    routeId: p.routeId,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lon: p.lon,
    stopOrder: p.stopOrder,
    kind: p.kind,
    createdAt: p.createdAt,
  };
}

type PickupPatch = Partial<Omit<typeof pickupPoints.$inferInsert, "id" | "createdAt">>;

function parsePickupPoint(raw: unknown): PickupPatch {
  const body = objectBody(raw);
  return {
    routeId: requiredText(body, "routeId", 64),
    name: optionalText(body, "name", 200),
    address: optionalText(body, "address", 500),
    ...optionalCoords(body),
    stopOrder: optionalInt(body, "stopOrder", 0, 1000) ?? undefined,
    // station | curb | on_request (the admin form's kinds).
    kind: optionalText(body, "kind", 32),
  };
}

async function assertRoute(routeId: string): Promise<void> {
  const db = await getDb();
  const [route] = await db.select({ id: routes.id }).from(routes).where(eq(routes.id, routeId));
  if (!route) throw badRequest("routeId names no route");
}

export async function createPickupPoint(raw: unknown): Promise<{ id: string }> {
  const patch = parsePickupPoint(raw);
  if (!patch.routeId) throw badRequest("routeId is required");
  await assertRoute(patch.routeId);
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(pickupPoints).values({
    stopOrder: 0,
    ...patch,
    id,
    routeId: patch.routeId,
    createdAt: new Date().toISOString(),
  });
  return { id };
}

export async function updatePickupPoint(id: string, raw: unknown): Promise<{ id: string }> {
  const patch = parsePickupPoint(raw);
  if (patch.routeId) await assertRoute(patch.routeId);
  const db = await getDb();
  const updated = await db
    .update(pickupPoints)
    .set(patch)
    .where(eq(pickupPoints.id, id))
    .returning({ id: pickupPoints.id });
  if (updated.length === 0) throw notFound("pickup point not found");
  return { id };
}

/** `DELETE /api/admin/pickup-points/{id}`. */
export async function deletePickupPoint(id: string): Promise<{ id: string }> {
  const db = await getDb();
  const deleted = await db
    .delete(pickupPoints)
    .where(eq(pickupPoints.id, id))
    .returning({ id: pickupPoints.id });
  if (deleted.length === 0) throw notFound("pickup point not found");
  return { id };
}

/** `GET /api/admin/pickup-points?routeId=`: a route's points in stop order. */
export async function adminPickupPointList(routeId?: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(pickupPoints)
    .where(routeId ? eq(pickupPoints.routeId, routeId) : undefined)
    .orderBy(asc(pickupPoints.stopOrder));
  return { items: rows.map(adminPickupPointOut) };
}
