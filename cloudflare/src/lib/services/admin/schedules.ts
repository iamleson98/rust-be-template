/**
 * Admin schedules — the staff list (`GET /api/admin/schedules`) and the writes,
 * `POST /api/admin/schedules` and
 * `PUT /api/admin/schedules/{id}`.
 *
 * One parser checks what the schedule form sends, for both. On an update a
 * field left out keeps its value (`null` or `""` clears an optional one), and
 * `points` / `classFares`, when present, replace the whole list. The schedule
 * row and its lists are written in one D1 batch, so a failure part-way can
 * never leave a schedule without its stops.
 */
import { getDb, atomicBatch, type AtomicStatement, type Database } from "@/lib/db/client";
import { eq, inArray } from "drizzle-orm";
import {
  addresses,
  schedules,
  schedulePoints,
  scheduleFares,
  vehicleTypes,
  routes,
} from "@/lib/db/schema";
import { adminAddressOut } from "./addresses";
import { badRequest, notFound } from "../http-errors";
import { repriceUpcoming } from "../fares";
import { type Body, isRecord, objectBody, optionalText, requiredText } from "../input";

/** `AdminScheduleOut` — schedule + class fares + ordered points (w/ address). */
export async function adminScheduleList(routeId?: string) {
  const db = await getDb();
  const scheds = await db
    .select()
    .from(schedules)
    .where(routeId ? eq(schedules.routeId, routeId) : undefined)
    .orderBy(schedules.departureTime);
  if (scheds.length === 0) return [];
  const ids = scheds.map((s) => s.id);

  const fareRows = await db
    .select()
    .from(scheduleFares)
    .where(inArray(scheduleFares.scheduleId, ids));
  const pointRows = await db
    .select({ point: schedulePoints, address: addresses })
    .from(schedulePoints)
    .innerJoin(addresses, eq(addresses.id, schedulePoints.addressId))
    .where(inArray(schedulePoints.scheduleId, ids))
    .orderBy(schedulePoints.stopOrder);
  const vtRows = await db.select().from(vehicleTypes);

  return scheds.map((s) => {
    const vt = vtRows.find((v) => v.id === s.vehicleTypeId);
    return {
      id: s.id,
      routeId: s.routeId,
      departureTime: s.departureTime,
      effectiveFrom: s.effectiveFrom,
      effectiveTo: s.effectiveTo,
      daysOfWeek: s.daysOfWeek,
      busLayoutId: s.busLayoutId,
      basePriceAdult: s.basePriceAdult,
      basePriceChild: s.basePriceChild,
      amenities: s.amenities,
      vehicleTypeId: s.vehicleTypeId,
      vehicleType: vt ? { id: vt.id, code: vt.code, label: vt.label } : null,
      classFares: fareRows
        .filter((f) => f.scheduleId === s.id)
        .map((f) => ({
          seatClass: f.seatClass,
          priceAdult: f.priceAdult,
          priceChild: f.priceChild,
        })),
      points: pointRows
        .filter((p) => p.point.scheduleId === s.id)
        .map((p) => ({
          id: p.point.id,
          scheduleId: p.point.scheduleId,
          addressId: p.point.addressId,
          stopOrder: p.point.stopOrder,
          kind: p.point.kind,
          arrivalTime: p.point.arrivalTime,
          address: adminAddressOut(p.address),
        })),
      createdAt: s.createdAt,
    };
  });
}

type ScheduleRow = typeof schedules.$inferSelect;
type ScheduleFields = Partial<Omit<ScheduleRow, "id" | "createdAt">>;
type PointRow = typeof schedulePoints.$inferInsert;
type FareRow = typeof scheduleFares.$inferInsert;

/** Most stops and seat classes one schedule may carry. */
const MAX_POINTS = 100;
const MAX_FARES = 50;
/** Highest price accepted, VND. */
const MAX_PRICE = 100_000_000;
/** 14 rows × 7 bound parameters = 98, under D1's 100 per statement. */
const ROWS_PER_INSERT = 14;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** Weekdays it runs, Monday first: `1111100` is Monday to Friday. */
const DAY_MASK = /^[01]{7}$/;

function price(v: unknown, key: string, min: number): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > MAX_PRICE)
    throw badRequest(`${key} must be a whole number of VND from ${min} to ${MAX_PRICE}`);
  return v as number;
}

function time(v: unknown, key: string): string {
  if (typeof v !== "string" || !HHMM.test(v.trim())) throw badRequest(`${key} must be HH:MM`);
  return v.trim();
}

function date(body: Body, key: string): string | null | undefined {
  const v = optionalText(body, key, 10);
  if (v && (!YMD.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))))
    throw badRequest(`${key} must be YYYY-MM-DD`);
  return v;
}

function parsePoints(scheduleId: string, raw: unknown): PointRow[] {
  if (!Array.isArray(raw)) throw badRequest("points must be a list");
  const now = new Date().toISOString();
  const rows = raw.flatMap((p: unknown) => {
    if (!isRecord(p)) throw badRequest("each point must be an object");
    const addressId = typeof p.addressId === "string" ? p.addressId.trim() : "";
    if (!addressId) return [];
    const arrival =
      p.arrivalTime == null || p.arrivalTime === "" ? null : time(p.arrivalTime, "arrivalTime");
    return [{ addressId, arrivalTime: arrival }];
  });
  if (rows.length < 2) throw badRequest("points needs a departure and a destination");
  if (rows.length > MAX_POINTS) throw badRequest(`at most ${MAX_POINTS} points`);
  return rows.map((p, i) => ({
    id: crypto.randomUUID(),
    scheduleId,
    addressId: p.addressId,
    stopOrder: i + 1,
    kind: i === 0 ? "departure" : i === rows.length - 1 ? "destination" : "intermediate",
    arrivalTime: p.arrivalTime,
    createdAt: now,
  }));
}

function parseFares(scheduleId: string, raw: unknown): FareRow[] {
  if (!Array.isArray(raw)) throw badRequest("classFares must be a list");
  if (raw.length > MAX_FARES) throw badRequest(`at most ${MAX_FARES} seat classes`);
  const now = new Date().toISOString();
  const seen = new Set<string>();
  return raw.flatMap((f: unknown) => {
    if (!isRecord(f)) throw badRequest("each class fare must be an object");
    const seatClass = typeof f.seatClass === "string" ? f.seatClass.trim() : "";
    if (!seatClass || seatClass.length > 32) throw badRequest("seatClass must be 1..32 characters");
    // A standard seat costs the schedule's base price; a class listed twice keeps its first price.
    if (seatClass === "standard" || seen.has(seatClass)) return [];
    seen.add(seatClass);
    return [
      {
        id: crypto.randomUUID(),
        scheduleId,
        seatClass,
        priceAdult: price(f.priceAdult, "priceAdult", 1),
        priceChild:
          f.priceChild == null || f.priceChild === 0 ? null : price(f.priceChild, "priceChild", 1),
        createdAt: now,
        updatedAt: now,
      },
    ];
  });
}

/** What `body` sets on the schedule row, checked; absent keys are absent. */
export function parseScheduleFields(body: Body): ScheduleFields {
  const out: ScheduleFields = {};
  const routeId = requiredText(body, "routeId", 64);
  if (routeId !== undefined) out.routeId = routeId;
  if (body.departureTime !== undefined)
    out.departureTime = time(body.departureTime, "departureTime");

  const from = date(body, "effectiveFrom");
  const to = date(body, "effectiveTo");
  if (from !== undefined) out.effectiveFrom = from;
  if (to !== undefined) out.effectiveTo = to;
  if (from && to && from > to) throw badRequest("effectiveFrom must not be after effectiveTo");

  const days = optionalText(body, "daysOfWeek", 7);
  if (days && (!DAY_MASK.test(days) || !days.includes("1")))
    throw badRequest("daysOfWeek must be 7 digits of 0/1, Monday first, with at least one 1");
  // Every day is stored as no mask at all.
  if (days !== undefined) out.daysOfWeek = days === "1111111" ? null : days;

  const layout = optionalText(body, "busLayoutId", 64);
  if (layout !== undefined) out.busLayoutId = layout;
  const vehicle = optionalText(body, "vehicleTypeId", 64);
  if (vehicle !== undefined) out.vehicleTypeId = vehicle;
  const amenities = optionalText(body, "amenities", 2000);
  if (amenities !== undefined) out.amenities = amenities;

  if (body.basePriceAdult != null)
    out.basePriceAdult = price(body.basePriceAdult, "basePriceAdult", 0);
  // `0` or absent child price: the brand's child discount applies.
  if (body.basePriceChild !== undefined)
    out.basePriceChild =
      body.basePriceChild === null ? null : price(body.basePriceChild, "basePriceChild", 0);
  return out;
}

async function assertRoute(routeId: string): Promise<void> {
  const db = await getDb();
  const [route] = await db
    .select({ id: routes.id })
    .from(routes)
    .where(eq(routes.id, routeId))
    .limit(1);
  if (!route) throw badRequest("routeId names no route");
}

/** The statements that replace a schedule's points and fares, as `body` asks. */
function listWrites(db: Database, scheduleId: string, body: Body): AtomicStatement[] {
  const out: AtomicStatement[] = [];
  if (body.points != null) {
    const rows = parsePoints(scheduleId, body.points);
    out.push(db.delete(schedulePoints).where(eq(schedulePoints.scheduleId, scheduleId)));
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT)
      out.push(db.insert(schedulePoints).values(rows.slice(i, i + ROWS_PER_INSERT)));
  }
  if (body.classFares != null) {
    const rows = parseFares(scheduleId, body.classFares);
    out.push(db.delete(scheduleFares).where(eq(scheduleFares.scheduleId, scheduleId)));
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT)
      out.push(db.insert(scheduleFares).values(rows.slice(i, i + ROWS_PER_INSERT)));
  }
  return out;
}

/** Create a schedule with its points and fares. */
export async function createSchedule(body: unknown): Promise<{ id: string }> {
  const raw = objectBody(body);
  const fields = parseScheduleFields(raw);
  if (!fields.routeId || !fields.departureTime)
    throw badRequest("routeId and departureTime (HH:MM) are required");
  await assertRoute(fields.routeId);
  const db = await getDb();
  const id = crypto.randomUUID();
  await atomicBatch([
    db.insert(schedules).values({
      basePriceAdult: 0,
      ...fields,
      id,
      routeId: fields.routeId,
      departureTime: fields.departureTime,
      createdAt: new Date().toISOString(),
    }),
    ...listWrites(db, id, raw),
  ]);
  return { id };
}

/** Update a schedule; seats still for sale on its upcoming trips follow the new fares. */
export async function updateSchedule(id: string, body: unknown): Promise<{ id: string }> {
  const raw = objectBody(body);
  const fields = parseScheduleFields(raw);
  const db = await getDb();
  const [existing] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.id, id))
    .limit(1);
  if (!existing) throw notFound("schedule not found");
  if (fields.routeId) await assertRoute(fields.routeId);
  const writes = [
    ...(Object.keys(fields).length > 0
      ? [db.update(schedules).set(fields).where(eq(schedules.id, id))]
      : []),
    ...listWrites(db, id, raw),
  ];
  if (writes.length > 0) await atomicBatch(writes);
  await repriceUpcoming(id);
  return { id };
}

/** `DELETE /api/admin/schedules/{id}`: points and fares go with it. */
export async function deleteSchedule(id: string): Promise<{ id: string }> {
  const db = await getDb();
  const deleted = await db
    .delete(schedules)
    .where(eq(schedules.id, id))
    .returning({ id: schedules.id });
  if (deleted.length === 0) throw notFound("schedule not found");
  return { id };
}
