/** Admin routes: the staff list and the writes. */
import { getDb } from "@/lib/db/client";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { pickupPoints, routes, schedules } from "@/lib/db/schema";
import { findCity } from "@/lib/city-match";
import { countOf, groupedCounts } from "@/lib/db/counts";
import { purgeRoute } from "@/lib/services/route-media";
import { badRequest, notFound } from "../http-errors";
import { objectBody, optionalOneOf, optionalText, requiredText, STATUSES } from "../input";

/** `AdminRouteOut` — route row + endpoint names + schedule/pickup counts.
 * Page + total are two builder queries on one shared WHERE (drizzle's
 * `and()` skips undefined conditions — no conditional SQL strings). */
export async function adminRouteList(filters: {
  brandId?: string;
  q?: string;
  limit: number;
  offset: number;
}) {
  const db = await getDb();
  const q = filters.q?.trim();
  const where = and(
    filters.brandId !== undefined ? eq(routes.brandId, filters.brandId) : undefined,
    q !== undefined && q.length > 0
      ? or(
          like(routes.name, `%${q}%`),
          like(routes.startLocationId, `%${q}%`),
          like(routes.endLocationId, `%${q}%`),
        )
      : undefined,
  );
  const rows = await db
    .select({ route: routes })
    .from(routes)
    .where(where)
    .orderBy(desc(routes.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(routes)
    .where(where);
  const total = totalRows[0]?.total ?? 0;
  const ids = rows.map((r) => r.route.id);
  const [scheduleCounts, pickupCounts] = await Promise.all([
    groupedCounts(schedules, schedules.routeId, ids),
    groupedCounts(pickupPoints, pickupPoints.routeId, ids),
  ]);
  return {
    items: rows.map(({ route: r }) => ({
      id: r.id,
      brandId: r.brandId,
      name: r.name,
      startLocationId: r.startLocationId,
      endLocationId: r.endLocationId,
      startLocation: placePreview(r.startLocationId),
      endLocation: placePreview(r.endLocationId),
      status: r.status,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      scheduleCount: countOf(scheduleCounts, r.id),
      pickupPointCount: countOf(pickupCounts, r.id),
    })),
    total,
  };
}

/** `AdminPlacePreview` — slug id + display name from the city catalog. */
function placePreview(slug: string): { id: string; name: string; province: string | null } | null {
  const city = findCity(slug);
  if (!city) return null;
  return { id: slug, name: city.name, province: null };
}

// ── Writes ───────────────────────────────────────────────────────

function parseRoute(raw: unknown) {
  const body = objectBody(raw);
  return {
    // `null` detaches the route from its brand; absent keeps it.
    brandId: optionalText(body, "brandId", 64),
    name: requiredText(body, "name", 200),
    startLocationId: requiredText(body, "startLocationId", 64),
    endLocationId: requiredText(body, "endLocationId", 64),
    status: optionalOneOf(body, "status", STATUSES),
  };
}

/** `POST /api/admin/routes`. An unnamed route is named after its endpoints. */
export async function createRoute(raw: unknown): Promise<{ id: string }> {
  const r = parseRoute(raw);
  if (!r.startLocationId || !r.endLocationId)
    throw badRequest("startLocationId and endLocationId are required");
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(routes).values({
    id,
    brandId: r.brandId ?? null,
    name: r.name ?? `${r.startLocationId} → ${r.endLocationId}`,
    startLocationId: r.startLocationId,
    endLocationId: r.endLocationId,
    status: r.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

/** `PUT /api/admin/routes/{id}`: fields left out keep their values. */
export async function updateRoute(id: string, raw: unknown): Promise<{ id: string }> {
  const db = await getDb();
  const updated = await db
    .update(routes)
    .set({ ...parseRoute(raw), updatedAt: new Date().toISOString() })
    .where(eq(routes.id, id))
    .returning({ id: routes.id });
  if (updated.length === 0) throw notFound("route not found");
  return { id };
}

/** `DELETE /api/admin/routes/{id}`: the row cascades to schedules and pickup points. */
export async function deleteRoute(id: string): Promise<{ id: string }> {
  const db = await getDb();
  const [route] = await db.select({ id: routes.id }).from(routes).where(eq(routes.id, id));
  if (!route) throw notFound("route not found");
  // Purge the gallery's objects before the cascade makes their keys
  // unrecoverable; a storage hiccup must not block the deletion.
  await purgeRoute(id).catch((e: unknown) => console.warn("route-picture GC failed", e));
  await db.delete(routes).where(eq(routes.id, id));
  return { id };
}
