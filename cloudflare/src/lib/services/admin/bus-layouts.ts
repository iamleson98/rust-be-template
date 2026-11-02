/** Admin bus layouts: list, detail and the writes (the seat plan itself changes through `seat-plan.ts`). */
import { getDb } from "@/lib/db/client";
import { desc, eq, isNull, or, sql } from "drizzle-orm";
import { busLayouts } from "@/lib/db/schema";
import { badRequest, conflict, notFound } from "../http-errors";
import { isRecord, objectBody, optionalText, requiredText } from "../input";
import {
  deriveFromSeats,
  layoutInUse,
  layoutSeats,
  parseSeatPlan,
  replaceSeatPlan,
  toStored,
  trustedPlan,
  validateSeatPlan,
  type SeatPlan,
} from "@/lib/services/seat-plan";

// The routes read the plan type and parser from here.
export { parseSeatPlan, type SeatPlan };

/** `AdminBusLayoutOut` list (slim — plan and `inUse` live in the DETAIL
 * endpoint, exactly like the Rust `AdminBusLayoutOut`: the list contract
 * has no in-use field, and both SPAs read the lock from the detail fetch
 * when opening the editor). */
export async function adminBusLayoutList(filters: {
  brandId?: string;
  /** With `brandId`: the shared catalog (no brand) too. */
  includeShared?: boolean;
  limit: number;
  offset: number;
}) {
  const db = await getDb();
  const ofBrand =
    filters.brandId !== undefined ? eq(busLayouts.brandId, filters.brandId) : undefined;
  const where =
    ofBrand && filters.includeShared ? or(ofBrand, isNull(busLayouts.brandId)) : ofBrand;
  const rows = await db
    .select({ layout: busLayouts })
    .from(busLayouts)
    .where(where)
    .orderBy(desc(busLayouts.createdAt))
    .limit(filters.limit)
    .offset(filters.offset);
  const totalRows = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(busLayouts)
    .where(where);
  return {
    items: rows.map(({ layout: b }) => ({
      id: b.id,
      brandId: b.brandId,
      name: b.name,
      vehicleType: b.vehicleType,
      totalSeats: b.totalSeats,
      planned: b.layoutData !== null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })),
    total: totalRows[0]?.total ?? 0,
  };
}

/** `AdminBusLayoutDetail` — full row + parsed plan (Rust `get_bus_layout`).
 *
 * The plan is the saved one while it still agrees with the `seat` rows
 * (seat ids/classes filled in from the rows), else a plain grid derived
 * from them (`planned = false`) so legacy layouts open in the editor too
 * — never an empty `decks: []` (that crashed the SPA editor with
 * "Cannot read properties of undefined (reading 'cells')").
 */
export async function adminBusLayoutDetail(id: string) {
  const db = await getDb();
  const row = (await db.select().from(busLayouts).where(eq(busLayouts.id, id)).limit(1))[0];
  if (!row) return null;
  const seatRows = await layoutSeats(id);
  const trusted = trustedPlan(row.layoutData, seatRows);
  const plan = trusted ?? deriveFromSeats(seatRows);
  const inUse = await layoutInUse(id);
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    vehicleType: row.vehicleType,
    totalSeats: row.totalSeats,
    planned: trusted != null,
    plan,
    inUse,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Writes ───────────────────────────────────────────────────────

/** Largest generated grid: a double-deck coach has well under these. */
const MAX_GRID = { rows: 30, cols: 8, floors: 2 };

/** A plain-seat plan of `floors × rows × cols`, the aisle down the middle. */
function gridToPlan(grid: { rows?: unknown; cols?: unknown; floors?: unknown }): SeatPlan {
  const size = (v: unknown, min: number, max: number, fallback: number) =>
    Number.isInteger(v) ? Math.min(Math.max(v as number, min), max) : fallback;
  const rows = size(grid.rows, 1, MAX_GRID.rows, 4);
  const cols = size(grid.cols, 2, MAX_GRID.cols, 4);
  const floors = size(grid.floors, 1, MAX_GRID.floors, 1);
  const decks: SeatPlan["decks"] = [];
  for (let f = 0; f < floors; f++) {
    const cells: SeatPlan["decks"][number]["cells"] = [];
    let n = f === 0 ? 0 : 100;
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        if (cols >= 4 && c === Math.ceil(cols / 2)) continue; // centre aisle
        n += 1;
        cells.push({
          row: r,
          col: c,
          kind: "seat",
          label: String(n).padStart(2, "0"),
          seatClass: null,
          seatId: null,
        });
      }
    }
    decks.push({
      name: floors > 1 ? (f === 0 ? "Tầng dưới" : "Tầng trên") : null,
      rows,
      cols,
      cells,
    });
  }
  return { decks };
}

/**
 * `POST /api/admin/bus-layouts`: a layout from a full `plan`, else from a
 * `seatGrid`, else empty. The plan is checked as the editor checks it, and
 * its seat rows are written with it.
 */
export async function createBusLayout(raw: unknown): Promise<{ id: string }> {
  const body = objectBody(raw);
  const name = requiredText(body, "name", 200);
  if (!name) throw badRequest("name is required");
  const plan: SeatPlan | null = isRecord(body.plan)
    ? (body.plan as SeatPlan)
    : isRecord(body.seatGrid)
      ? gridToPlan(body.seatGrid)
      : null;
  if (plan) {
    const invalid = validateSeatPlan(plan);
    if (invalid) throw badRequest(invalid);
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(busLayouts).values({
    id,
    brandId: optionalText(body, "brandId", 64) ?? null,
    name,
    vehicleType: optionalText(body, "vehicleType", 32) ?? null,
    layoutData: plan ? toStored(plan) : null,
    createdAt: now,
    updatedAt: now,
  });
  // One seat row per sellable cell; also writes the stored plan and seat count back.
  if (plan) await replaceSeatPlan(id, plan);
  return { id };
}

/**
 * `PUT /api/admin/bus-layouts/{id}`: the name, brand and vehicle type; a
 * field left out keeps its value. The plan and seat count change only
 * through `/plan`, which checks the plan and keeps the seat rows in step.
 */
export async function updateBusLayout(id: string, raw: unknown): Promise<{ id: string }> {
  const body = objectBody(raw);
  const db = await getDb();
  const updated = await db
    .update(busLayouts)
    .set({
      name: requiredText(body, "name", 200),
      brandId: optionalText(body, "brandId", 64),
      vehicleType: optionalText(body, "vehicleType", 32),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(busLayouts.id, id))
    .returning({ id: busLayouts.id });
  if (updated.length === 0) throw notFound("bus layout not found");
  return { id };
}

/** `DELETE /api/admin/bus-layouts/{id}`: refused while a schedule uses the layout. */
export async function deleteBusLayout(id: string): Promise<{ id: string }> {
  const detail = await adminBusLayoutDetail(id);
  if (!detail) throw notFound("bus layout not found");
  if (detail.inUse) throw conflict("layout is referenced by a schedule");
  const db = await getDb();
  await db.delete(busLayouts).where(eq(busLayouts.id, id));
  return { id };
}
