/** Admin vehicle types: the staff list and the writes. */
import { getDb } from "@/lib/db/client";
import { eq, like, or, sql } from "drizzle-orm";
import { badRequest, conflict, notFound } from "../http-errors";
import { objectBody, optionalInt, optionalOneOf, requiredText, STATUSES } from "../input";
import { vehicleTypes } from "@/lib/db/schema";

/** `AdminVehicleTypeOut` list. */
export async function adminVehicleTypeList(filters: { q?: string; limit: number; offset: number }) {
  const db = await getDb();
  const q = filters.q?.trim();
  const where =
    q !== undefined && q.length > 0
      ? or(like(vehicleTypes.label, `%${q}%`), like(vehicleTypes.code, `%${q}%`))
      : undefined;
  const rows = await db
    .select()
    .from(vehicleTypes)
    .where(where)
    .orderBy(vehicleTypes.sortOrder, vehicleTypes.code)
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(vehicleTypes)
    .where(where);
  return {
    items: rows.map((v) => ({
      id: v.id,
      code: v.code,
      label: v.label,
      totalSeats: v.totalSeats,
      sortOrder: v.sortOrder,
      status: v.status,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    })),
    total: totalRows[0]?.total ?? 0,
  };
}

// ── Writes ───────────────────────────────────────────────────────

function parseVehicleType(raw: unknown) {
  const body = objectBody(raw);
  return {
    code: requiredText(body, "code", 32),
    label: requiredText(body, "label", 100),
    totalSeats: optionalInt(body, "totalSeats", 1, 100),
    sortOrder: optionalInt(body, "sortOrder", -1000, 1000) ?? undefined,
    status: optionalOneOf(body, "status", STATUSES),
  };
}

async function assertCodeFree(code: string, except?: string): Promise<void> {
  const db = await getDb();
  const [taken] = await db
    .select({ id: vehicleTypes.id })
    .from(vehicleTypes)
    .where(eq(vehicleTypes.code, code));
  if (taken && taken.id !== except) throw conflict("code already exists");
}

/** `POST /api/admin/vehicle-types`; 409 for a code in use. */
export async function createVehicleType(raw: unknown): Promise<{ id: string }> {
  const v = parseVehicleType(raw);
  if (!v.code || !v.label) throw badRequest("code and label are required");
  await assertCodeFree(v.code);
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(vehicleTypes).values({
    ...v,
    id,
    code: v.code,
    label: v.label,
    sortOrder: v.sortOrder ?? 0,
    status: v.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

/** `PUT /api/admin/vehicle-types/{id}`: fields left out keep their values. */
export async function updateVehicleType(id: string, raw: unknown): Promise<{ id: string }> {
  const v = parseVehicleType(raw);
  if (v.code) await assertCodeFree(v.code, id);
  const db = await getDb();
  const updated = await db
    .update(vehicleTypes)
    .set({ ...v, updatedAt: new Date().toISOString() })
    .where(eq(vehicleTypes.id, id))
    .returning({ id: vehicleTypes.id });
  if (updated.length === 0) throw notFound("vehicle type not found");
  return { id };
}

/** `DELETE /api/admin/vehicle-types/{id}`. */
export async function deleteVehicleType(id: string): Promise<{ id: string }> {
  const db = await getDb();
  const deleted = await db
    .delete(vehicleTypes)
    .where(eq(vehicleTypes.id, id))
    .returning({ id: vehicleTypes.id });
  if (deleted.length === 0) throw notFound("vehicle type not found");
  return { id };
}
