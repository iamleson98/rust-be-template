/** Admin brand addresses (offices, stations, stops): output shape and writes. */
import { and, asc, count, eq, like, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { addresses, schedulePoints } from "@/lib/db/schema";
import { findCity } from "@/lib/city-match";
import { badRequest, conflict, notFound } from "../http-errors";
import { objectBody, optionalCoords, optionalText, requiredText } from "../input";

/** The `address` table row as drizzle selects it — shared by the
 * serializers and the routes that build these rows by hand. */
export type AddressRow = typeof addresses.$inferSelect;

export function adminAddressOut(a: AddressRow) {
  return {
    id: a.id,
    brandId: a.brandId,
    name: a.name,
    address: a.address,
    lat: a.lat ?? 0,
    lon: a.lon ?? 0,
    cityId: a.cityId,
    province: a.province,
    district: a.district,
    ward: a.ward,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// ── List ─────────────────────────────────────────────────────────

/**
 * `GET /api/admin/addresses`: a brand's addresses by name, each with how many
 * schedule stops use it (`stopCount`). `q` matches the name or the street;
 * without `limit` every row comes back (the schedule form's picker pages).
 */
export async function adminAddressList(filters: {
  brandId?: string;
  q?: string;
  limit?: number;
  offset: number;
}) {
  const db = await getDb();
  const where = and(
    filters.brandId ? eq(addresses.brandId, filters.brandId) : undefined,
    filters.q
      ? or(like(addresses.name, `%${filters.q}%`), like(addresses.address, `%${filters.q}%`))
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        address: addresses,
        // Spelled out: inside the subquery drizzle would print both ids unqualified.
        stopCount: sql<number>`(SELECT COUNT(*) FROM "schedule_point" sp WHERE sp."address_id" = "address"."id")`,
      })
      .from(addresses)
      .where(where)
      .orderBy(asc(addresses.name))
      .limit(filters.limit ?? 1000)
      .offset(filters.offset),
    db.select({ n: count() }).from(addresses).where(where),
  ]);
  return {
    items: rows.map((r) => ({ ...adminAddressOut(r.address), stopCount: Number(r.stopCount) })),
    total: Number(total?.n ?? 0),
  };
}

// ── Writes ───────────────────────────────────────────────────────

function parseAddress(raw: unknown) {
  const body = objectBody(raw);
  const cityId = requiredText(body, "cityId", 64);
  const city = cityId === undefined ? undefined : findCity(cityId);
  if (city === null) throw badRequest(`cityId: unknown city ${JSON.stringify(cityId)}`);
  return {
    brandId: requiredText(body, "brandId", 64),
    name: requiredText(body, "name", 200),
    address: optionalText(body, "address", 500),
    ...optionalCoords(body),
    // The city's slug and its display name always travel together.
    ...(city && { cityId: city.slug, province: city.name }),
    district: optionalText(body, "district", 100),
    ward: optionalText(body, "ward", 100),
  };
}

/** `POST /api/admin/addresses`: an address in one of our cities. */
export async function createAddress(raw: unknown): Promise<{ id: string }> {
  const a = parseAddress(raw);
  if (!a.brandId || !a.name) throw badRequest("brandId and name are required");
  if (!a.cityId) throw badRequest("cityId is required");
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(addresses).values({
    ...a,
    id,
    brandId: a.brandId,
    name: a.name,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

/** `PUT /api/admin/addresses/{id}`: fields left out keep their values, blank clears text. */
export async function updateAddress(id: string, raw: unknown): Promise<{ id: string }> {
  const db = await getDb();
  const updated = await db
    .update(addresses)
    .set({ ...parseAddress(raw), updatedAt: new Date().toISOString() })
    .where(eq(addresses.id, id))
    .returning({ id: addresses.id });
  if (updated.length === 0) throw notFound("address not found");
  return { id };
}

/** `DELETE /api/admin/addresses/{id}`: refused while a schedule stops there (it would drop the stop). */
export async function deleteAddress(id: string): Promise<{ id: string }> {
  const db = await getDb();
  const [row] = await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.id, id));
  if (!row) throw notFound("address not found");
  const [used] = await db
    .select({ n: count() })
    .from(schedulePoints)
    .where(eq(schedulePoints.addressId, id));
  if ((used?.n ?? 0) > 0) throw conflict(`address is a stop of ${used?.n} schedule(s)`);
  await db.delete(addresses).where(eq(addresses.id, id));
  return { id };
}
