/**
 * Trip materialization — port of `trip_warmer.rs`, the warm-ahead engine
 * behind trip search.
 *
 * Trips ahead, seats on demand: only trip rows are created ahead (one small
 * row per schedule and day, carrying the capacity and the seats left — all
 * search needs). A trip's ~40 priced seat rows are created the first time
 * its seat map is shown or a booking holds it (`ensureSeats`); creating
 * them for the whole window made the Rust database grow past 650 MB for
 * trips nobody opened.
 *
 * Two callers fill gaps with the same `materializeMissing`:
 *  - the cron (`warmTrips`, every six hours) covers the whole sell window;
 *  - a search for a date fills the schedules it found missing inline, under
 *    a strict time budget, and degrades to "serve what exists" when another
 *    fill of that date is already running (Rust `Warmer::try_fill`).
 */
import { and, eq, sql } from "drizzle-orm";
import { atomicBatch, getDb, inList, rawRun, type Database } from "@/lib/db/client";
import {
  scheduleFares,
  schedules,
  seatInventory,
  seats,
  tripSessions,
  vehicleTypes,
} from "@/lib/db/schema";
import { classOf, fareOf, fareTable } from "./fares";
import { localToday } from "./trip-time";

type ScheduleRow = typeof schedules.$inferSelect;

/** Days ahead (inclusive of today) that stay warm — and that a customer can book. */
export const SELL_WINDOW_DAYS = 14;

/** How long a search may spend filling gaps inline (Rust `INLINE_FILL_BUDGET`). */
export const INLINE_FILL_BUDGET_MS = 2000;

/** Trip rows per INSERT: 11 columns × 9 rows stay under D1's 100-parameter cap. */
const TRIP_ROWS_PER_INSERT = 9;
/** Seat-inventory rows per INSERT: 9 columns × 10 rows. */
const SEAT_ROWS_PER_INSERT = 10;
/** INSERT statements per D1 batch. */
const STATEMENTS_PER_BATCH = 25;

const DAY_MS = 86_400_000;

const chunked = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// ── Which days a schedule runs ───────────────────────────────────

/** `today .. today + (days - 1)`, each `YYYY-MM-DD`; empty when `today` is malformed. */
export function sellWindow(today: string, days: number): string[] {
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(start)) return [];
  return Array.from({ length: days }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

/** Does a schedule with `daysOfWeek` operate on `date` (`YYYY-MM-DD`)? */
export function runsOnDate(daysOfWeek: string | null, date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`);
  const mondayFirst = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const raw = daysOfWeek?.trim();
  // Rust: a 7-character 0/1 mask, index 0 = Monday; anything else is daily.
  if (raw && /^[01]{7}$/.test(raw)) return raw[mondayFirst] === "1";
  // The port's earlier JSON array of 1..7 (Sunday = 1).
  if (raw?.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed.map(Number).includes(d.getUTCDay() + 1);
    } catch {
      /* malformed → daily */
    }
  }
  return true;
}

/**
 * Does the schedule operate on `date`: inside its optional
 * `effectiveFrom`/`effectiveTo` window (plain `YYYY-MM-DD` compare) and on a
 * weekday its mask allows (Rust `schedule_runs_on`).
 */
export function scheduleRunsOn(
  s: Pick<ScheduleRow, "effectiveFrom" | "effectiveTo" | "daysOfWeek">,
  date: string,
): boolean {
  if (s.effectiveFrom && date < s.effectiveFrom) return false;
  if (s.effectiveTo && date > s.effectiveTo) return false;
  return runsOnDate(s.daysOfWeek, date);
}

// ── Trips ahead ──────────────────────────────────────────────────

/** Dates whose fill is running in this isolate. */
const filling = new Set<string>();

/**
 * Create the `trip_session` rows of the schedules that run on `date` and have
 * none yet; returns how many were created. Past dates are never filled.
 *
 * Capacity per schedule: its layout's seat count; else, for a schedule with
 * no layout, its vehicle type's `total_seats` (the trip appears in search
 * but has no seat map); else the schedule is skipped — nothing to sell.
 * `deadlineMs` bounds the work: whatever was built before it passes is
 * still inserted and the next pass finishes the rest.
 */
export async function materializeMissing(
  candidates: ScheduleRow[],
  date: string,
  deadlineMs?: number,
): Promise<number> {
  if (date < localToday()) return 0;
  const running = candidates.filter((s) => scheduleRunsOn(s, date));
  if (running.length === 0) return 0;
  const db = await getDb();
  const existing = new Set(
    (
      await db
        .select({ scheduleId: tripSessions.scheduleId })
        .from(tripSessions)
        .where(
          and(
            inList(
              tripSessions.scheduleId,
              running.map((s) => s.id),
            ),
            eq(tripSessions.departureDate, date),
          ),
        )
    ).map((t) => t.scheduleId),
  );
  const missing = running.filter((s) => !existing.has(s.id));
  if (missing.length === 0) return 0;

  const capacity = await capacities(db, missing);
  const now = new Date().toISOString();
  const rows: Array<typeof tripSessions.$inferInsert> = [];
  for (const s of missing) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) break;
    const seatCount = capacity(s);
    if (seatCount <= 0) continue;
    rows.push({
      id: crypto.randomUUID(),
      scheduleId: s.id,
      departureDate: date,
      status: "scheduled",
      totalSeats: seatCount,
      availableSeats: seatCount,
      createdAt: now,
      updatedAt: now,
    });
  }

  let created = 0;
  for (const batch of chunked(chunked(rows, TRIP_ROWS_PER_INSERT), STATEMENTS_PER_BATCH)) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) break;
    const results = await atomicBatch(
      batch.map((part) =>
        db
          .insert(tripSessions)
          .values(part)
          .onConflictDoNothing({ target: [tripSessions.scheduleId, tripSessions.departureDate] }),
      ),
    );
    created += results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return created;
}

/** Seats a new trip of each schedule starts with, from two batched reads. */
async function capacities(db: Database, missing: ScheduleRow[]) {
  const layoutIds = [...new Set(missing.flatMap((s) => (s.busLayoutId ? [s.busLayoutId] : [])))];
  const typeIds = [
    ...new Set(
      missing.flatMap((s) => (!s.busLayoutId && s.vehicleTypeId ? [s.vehicleTypeId] : [])),
    ),
  ];
  const [layoutSeats, typeSeats] = await Promise.all([
    db
      .select({ layoutId: seats.busLayoutId, n: sql<number>`COUNT(*)` })
      .from(seats)
      .where(inList(seats.busLayoutId, layoutIds))
      .groupBy(seats.busLayoutId),
    db
      .select({ id: vehicleTypes.id, n: vehicleTypes.totalSeats })
      .from(vehicleTypes)
      .where(inList(vehicleTypes.id, typeIds)),
  ]);
  const byLayout = new Map(layoutSeats.map((l) => [l.layoutId, Number(l.n)]));
  const byType = new Map(typeSeats.map((t) => [t.id, t.n ?? 0]));
  return (s: ScheduleRow): number => {
    const own = s.busLayoutId ? (byLayout.get(s.busLayoutId) ?? 0) : 0;
    if (own > 0) return own;
    return !s.busLayoutId && s.vehicleTypeId ? (byType.get(s.vehicleTypeId) ?? 0) : 0;
  };
}

/**
 * A search found these schedules without a trip on `date`: create them
 * inline within the time budget. Failures and a fill already running for the
 * date degrade to serving whatever exists — a search never fails or queues
 * behind a fill (Rust `fill_trips_inline`).
 */
export async function fillInline(
  candidates: ScheduleRow[],
  date: string,
  deadlineMs: number = Date.now() + INLINE_FILL_BUDGET_MS,
): Promise<void> {
  if (candidates.length === 0 || filling.has(date)) return;
  filling.add(date);
  try {
    await materializeMissing(candidates, date, deadlineMs);
  } catch (e) {
    console.warn("[trips] inline fill failed — serving existing rows", date, e);
  } finally {
    filling.delete(date);
  }
}

// ── Seats on demand ──────────────────────────────────────────────

/**
 * Create `tripId`'s seat rows if it has none yet, priced from the current
 * fares. Idempotent and race-safe: seats another request created meanwhile
 * are skipped (the trip+seat unique index). Layout-less schedules sell by
 * count and have no seat rows (Rust `ensure_seats`).
 */
export async function ensureSeats(
  db: Database,
  tripId: string,
  schedule: ScheduleRow,
): Promise<void> {
  if (!schedule.busLayoutId) return;
  const seated = await db
    .select({ id: seatInventory.id })
    .from(seatInventory)
    .where(eq(seatInventory.tripSessionId, tripId))
    .limit(1);
  if (seated.length > 0) return;
  const layoutSeats = await db
    .select({ id: seats.id, seatClass: seats.seatClass })
    .from(seats)
    .where(eq(seats.busLayoutId, schedule.busLayoutId));
  if (layoutSeats.length === 0) return;
  const rows = await db
    .select()
    .from(scheduleFares)
    .where(eq(scheduleFares.scheduleId, schedule.id));
  const table = fareTable(schedule, rows);
  const now = new Date().toISOString();
  const stmts = chunked(layoutSeats, SEAT_ROWS_PER_INSERT).map((part) =>
    db
      .insert(seatInventory)
      .values(
        part.map((s) => {
          const price = fareOf(table, classOf(s)).adult;
          return {
            id: crypto.randomUUID(),
            tripSessionId: tripId,
            seatId: s.id,
            status: "available",
            basePrice: price,
            finalPrice: price,
            currency: "VND",
            createdAt: now,
            updatedAt: now,
          };
        }),
      )
      .onConflictDoNothing({ target: [seatInventory.tripSessionId, seatInventory.seatId] }),
  );
  await atomicBatch(stmts);
}

// ── The cron ─────────────────────────────────────────────────────

/** Unsold seat rows deleted per statement, and statements per pass. */
const PRUNE_ROWS_PER_STATEMENT = 5000;
const PRUNE_STATEMENTS_PER_PASS = 8;

/**
 * Delete the unsold seat rows of trips that left before yesterday: they can
 * never be sold. Sold and held seats stay (booking history). A backlog is
 * worked off over successive passes (Rust `prune_departed_seats`).
 */
export async function pruneDepartedSeats(today: string): Promise<number> {
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  let deleted = 0;
  for (let pass = 0; pass < PRUNE_STATEMENTS_PER_PASS; pass++) {
    const res = await rawRun(sql`
      DELETE FROM seat_inventory WHERE id IN (
        SELECT si.id FROM seat_inventory si
        JOIN trip_session ts ON ts.id = si.trip_session_id
        WHERE si.status = 'available' AND ts.departure_date < ${yesterday}
        LIMIT ${PRUNE_ROWS_PER_STATEMENT})
    `);
    const n = res.meta.changes ?? 0;
    deleted += n;
    if (n < PRUNE_ROWS_PER_STATEMENT) break;
  }
  return deleted;
}

/** Cron: materialize the trips of the whole sell window, then prune departed seats. */
export async function warmTrips(): Promise<{ created: number; pruned: number }> {
  const db = await getDb();
  const today = localToday();
  const all = await db.select().from(schedules).limit(100_000);
  let created = 0;
  for (const date of sellWindow(today, SELL_WINDOW_DAYS)) {
    created += await materializeMissing(all, date);
  }
  return { created, pruned: await pruneDepartedSeats(today) };
}
