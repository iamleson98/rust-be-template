/**
 * Seat-plan engine — a faithful port of the Rust backend's
 * `service/seat_plan.rs` (validate / trusted_plan / derive_from_seats /
 * sync_seats / fit_to_seats) on top of Drizzle + D1.
 *
 * The `seat` rows are the source of truth for what trips sell; the plan
 * JSON (`bus_layout.layout_data`) is the editor's drawing of them. These
 * helpers keep the two in agreement:
 *
 *  - `validateSeatPlan` — structural checks (the messages are shown to
 *    admins as-is).
 *  - `trustedPlan` — the stored plan, but only while it still describes
 *    the `seat` rows exactly; seat ids/classes are filled in from the
 *    rows. A drifted plan is not trusted.
 *  - `deriveFromSeats` — a plain grid for layouts that predate plans, so
 *    the editor can open them (fixes the SPA crash on legacy layouts).
 *  - `syncSeatRows` — maps a plan onto the layout's existing seats
 *    (id/label preserving); refuses to add/remove seats while trips sell
 *    the layout.
 *  - `fitToSeats` — lays a catalog template over the existing seats
 *    (preview only; ids and labels are kept).
 */
import { count, eq, inArray } from "drizzle-orm";
import { getDb, atomicBatch, type AtomicStatement } from "@/lib/db/client";
import { repriceUpcoming } from "./fares";
import {
  bookingSeats,
  busLayouts,
  schedules,
  seatInventory,
  seats,
  tripSessions,
} from "@/lib/db/schema";

export type SeatPlan = {
  decks: Array<{
    name?: string | null;
    rows: number;
    cols: number;
    cells: Array<{
      row: number;
      col: number;
      kind: string;
      seatId?: string | null;
      label?: string | null;
      seatClass?: string | null;
    }>;
  }>;
};

/**
 * Serialize for `layout_data` (Rust `to_stored`): versioned, and without
 * seat ids — those are operational state, not part of the stored plan.
 */
export function toStored(plan: SeatPlan): string {
  return JSON.stringify({
    version: PLAN_VERSION,
    decks: plan.decks.map((d) => ({
      ...d,
      cells: d.cells.map((c) => ({ ...c, seatId: undefined })),
    })),
  });
}

/** Parse a bus_layout.layout_data JSON string into a SeatPlan. */
export function parseSeatPlan(layoutData: string | null | undefined): SeatPlan | null {
  if (!layoutData) return null;
  try {
    const parsed = JSON.parse(layoutData) as SeatPlan & { version?: number };
    if (!parsed || !Array.isArray(parsed.decks)) return null;
    // Rust stores `{version: 2, decks}`; anything else is a legacy/garbage
    // layout. Plans this port saved before it wrote a version have none.
    if (parsed.version !== undefined && parsed.version !== PLAN_VERSION) return null;
    return { decks: parsed.decks };
  } catch {
    return null;
  }
}

export type SeatRow = typeof seats.$inferSelect;

export const PLAN_VERSION = 2;
/** Mirrors the cap `create_bus_layout` has always enforced. */
export const MAX_SEATS = 120;
/** `seat.seat_label` is `VARCHAR(10)`. */
const MAX_LABEL_CHARS = 10;
/** `seat.seat_class` is `VARCHAR(30)`. */
const MAX_CLASS_CHARS = 30;
export const MAX_DECKS = 2;
export const MAX_ROWS = 30;
export const MAX_COLS = 9;
const MAX_DECK_NAME_CHARS = 40;

const SELLABLE_KINDS = new Set(["seat", "bed", "cabin", "cabin_double"]);

export function isSellable(kind: string): boolean {
  return SELLABLE_KINDS.has(kind);
}

/** Rust `CellKind::default_class` — class implied by the cell kind + deck. */
function defaultClass(kind: string, floor: number): string | null {
  if (kind === "bed" || kind === "cabin" || kind === "cabin_double") {
    return floor <= 1 ? "bed_lower" : "bed_upper";
  }
  return null;
}

/** Structural validation; returns the error message or null (shown to admins as-is). */
export function validateSeatPlan(plan: SeatPlan): string | null {
  if (plan.decks.length === 0 || plan.decks.length > MAX_DECKS) {
    return `a plan needs 1–${MAX_DECKS} decks`;
  }
  const labels = new Set<string>();
  let sellable = 0;
  for (let i = 0; i < plan.decks.length; i++) {
    const deck = plan.decks[i];
    const n = i + 1;
    if (!(deck.rows >= 1 && deck.rows <= MAX_ROWS) || !(deck.cols >= 1 && deck.cols <= MAX_COLS)) {
      return `deck ${n}: grid must be 1–${MAX_ROWS} rows × 1–${MAX_COLS} columns`;
    }
    if (deck.name != null && [...deck.name].length > MAX_DECK_NAME_CHARS) {
      return `deck ${n}: name is longer than ${MAX_DECK_NAME_CHARS} characters`;
    }
    const positions = new Set<string>();
    let drivers = 0;
    for (const cell of deck.cells) {
      if (!(cell.row >= 1 && cell.row <= deck.rows) || !(cell.col >= 1 && cell.col <= deck.cols)) {
        return `deck ${n}: cell (${cell.row}, ${cell.col}) is outside the ${deck.rows}×${deck.cols} grid`;
      }
      const key = `${cell.row},${cell.col}`;
      if (positions.has(key)) return `deck ${n}: two cells at row ${cell.row}, column ${cell.col}`;
      positions.add(key);
      if (cell.kind === "driver") drivers += 1;
      if (isSellable(cell.kind)) {
        sellable += 1;
        const label = cell.label?.trim() ?? "";
        const length = [...label].length;
        if (length === 0 || length > MAX_LABEL_CHARS) {
          return `deck ${n}: seat at row ${cell.row}, column ${cell.col} needs a label of 1–${MAX_LABEL_CHARS} characters`;
        }
        const lower = label.toLowerCase();
        if (labels.has(lower)) return `seat label "${label}" is used more than once`;
        labels.add(lower);
        if (cell.seatClass != null && [...cell.seatClass.trim()].length > MAX_CLASS_CHARS) {
          return `seat ${label}: class is longer than ${MAX_CLASS_CHARS} characters`;
        }
      }
    }
    if (drivers > 1) return `deck ${n}: only one driver position is allowed`;
  }
  if (sellable === 0) return "a plan needs at least one seat";
  if (sellable > MAX_SEATS) return `seat plan too large — max ${MAX_SEATS} seats`;
  return null;
}

/**
 * The stored plan, but only while it still describes the `seat` rows
 * exactly — same labels, on the same decks, in the same cells. Seat ids
 * and classes are filled in from the rows. A plan that has drifted from
 * the seats (direct DB edits, a legacy patch) is not trusted: callers
 * fall back to `deriveFromSeats`.
 */
export function trustedPlan(layoutData: string | null, seatRows: SeatRow[]): SeatPlan | null {
  const plan = parseSeatPlan(layoutData);
  if (!plan) return null;
  const unclaimed = new Map<string, SeatRow>();
  for (const s of seatRows) {
    unclaimed.set(`${s.floor}|${s.seatLabel.trim().toLowerCase()}`, s);
  }
  for (let i = 0; i < plan.decks.length; i++) {
    const floor = i + 1;
    for (const cell of plan.decks[i].cells) {
      if (!isSellable(cell.kind)) continue;
      const label = cell.label?.trim().toLowerCase();
      if (!label) return null;
      const seat = unclaimed.get(`${floor}|${label}`);
      if (!seat) return null;
      if (seat.rowNum !== cell.row || seat.colNum !== cell.col) return null;
      cell.seatId = seat.id;
      cell.seatClass = seat.seatClass;
      unclaimed.delete(`${floor}|${label}`);
    }
  }
  if (unclaimed.size > 0) return null;
  return plan;
}

/**
 * A plain grid for layouts that predate plans, so the editor can open
 * them. Berth classes (`bed_*`) are recognised; no fixtures are invented.
 */
export function deriveFromSeats(seatRows: SeatRow[]): SeatPlan {
  const cmp = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...seatRows].sort(
    (a, b) =>
      cmp(a.floor, b.floor) ||
      cmp(a.rowNum ?? 0, b.rowNum ?? 0) ||
      cmp(a.colNum ?? 0, b.colNum ?? 0) ||
      cmp(a.seatLabel, b.seatLabel),
  );
  const decks: SeatPlan["decks"] = [];
  for (let deckNo = 1; deckNo <= MAX_DECKS; deckNo++) {
    const inDeck = sorted.filter((s) => Math.min(Math.max(s.floor, 1), MAX_DECKS) === deckNo);
    if (inDeck.length === 0) continue;
    // Rows/cols missing on very old seats: fall back to rows of four.
    const placed = inDeck.map((s, i) => ({
      row: Math.max(s.rowNum ?? Math.floor(i / 4) + 1, 1),
      col: Math.max(s.colNum ?? (i % 4) + 1, 1),
      seat: s,
    }));
    const rows = Math.min(Math.max(...placed.map((p) => p.row), 1), MAX_ROWS);
    const cols = Math.min(Math.max(...placed.map((p) => p.col), 1), MAX_COLS);
    const cells = placed
      .filter((p) => p.row <= rows && p.col <= cols)
      .map(({ row, col, seat }) => ({
        row,
        col,
        kind: seat.seatClass?.startsWith("bed_") ? "bed" : "seat",
        label: seat.seatLabel,
        seatClass: seat.seatClass,
        seatId: seat.id,
      }));
    decks.push({ name: null, rows, cols, cells });
  }
  return { decks };
}

/** Window seats: first and last sellable column of each row (Rust parity). */
function windowCells(deck: SeatPlan["decks"][number]): Set<string> {
  const byRow = new Map<number, number[]>();
  for (const c of deck.cells) {
    if (!isSellable(c.kind)) continue;
    const arr = byRow.get(c.row) ?? [];
    arr.push(c.col);
    byRow.set(c.row, arr);
  }
  const windows = new Set<string>();
  for (const [row, cols] of byRow) {
    windows.add(`${row},${Math.min(...cols)}`);
    windows.add(`${row},${Math.max(...cols)}`);
  }
  return windows;
}

/** Target state of one seat row (Rust `SeatSpec`). */
export interface SeatSpec {
  label: string;
  seatClass: string | null;
  row: number;
  col: number;
  floor: number;
  isWindow: boolean;
}

export interface SeatSync {
  updates: Array<{ seatId: string; spec: SeatSpec }>;
  inserts: SeatSpec[];
  deletes: string[];
}

export class InUseError extends Error {
  constructor(
    public readonly kind: "added" | "removed",
    public readonly count: number,
  ) {
    super(
      `Sơ đồ ghế đã có chuyến hoặc vé sử dụng — không thể ${kind === "added" ? "thêm" : "bớt"} ${count} ghế (chỉ được di chuyển, đổi tên hoặc đổi hạng các ghế hiện có)`,
    );
    this.name = "InUseError";
  }
}

/** Map `plan` onto the layout's `existing` seats (id/label preserving). */
export function syncSeatRows(existing: SeatRow[], plan: SeatPlan, inUse: boolean): SeatSync {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const byLabel = new Map(existing.map((s) => [s.seatLabel.trim().toLowerCase(), s]));
  const taken = new Set<string>();
  const sync: SeatSync = { updates: [], inserts: [], deletes: [] };

  plan.decks.forEach((deck, deckIdx) => {
    const floor = deckIdx + 1;
    const windows = windowCells(deck);
    for (const cell of deck.cells) {
      if (!isSellable(cell.kind)) continue;
      const label = cell.label?.trim() ?? "";
      const spec: SeatSpec = {
        label,
        seatClass:
          cell.seatClass?.trim() && cell.seatClass.trim().length > 0
            ? cell.seatClass.trim()
            : defaultClass(cell.kind, floor),
        row: cell.row,
        col: cell.col,
        floor,
        isWindow: windows.has(`${cell.row},${cell.col}`),
      };
      let target: SeatRow | undefined;
      if (cell.seatId && byId.has(cell.seatId) && !taken.has(cell.seatId)) {
        target = byId.get(cell.seatId);
      } else {
        const byLbl = byLabel.get(label.toLowerCase());
        if (byLbl && !taken.has(byLbl.id)) target = byLbl;
      }
      if (target) {
        taken.add(target.id);
        sync.updates.push({ seatId: target.id, spec });
      } else {
        sync.inserts.push(spec);
      }
    }
  });
  sync.deletes = existing.filter((s) => !taken.has(s.id)).map((s) => s.id);

  if (inUse) {
    // Refuse is thrown by the caller after checking; keep sync pure so
    // tests can inspect it — the guard lives in `applySeatPlan`.
    if (sync.inserts.length > 0) throw new InUseError("added", sync.inserts.length);
    if (sync.deletes.length > 0) throw new InUseError("removed", sync.deletes.length);
  }
  return sync;
}

/** `A2` < `A10` < `B1`: letters first, then the number, then the rest. */
function naturalKey(label: string): [string, number, string] {
  const trimmed = label.trim().toLowerCase();
  const digits = "0123456789";
  let i = 0;
  while (i < trimmed.length && !digits.includes(trimmed[i])) i++;
  const letters = trimmed.slice(0, i);
  let j = i;
  while (j < trimmed.length && digits.includes(trimmed[j])) j++;
  const num = Number.parseInt(trimmed.slice(i, j) || "0", 10);
  return [letters, num, trimmed.slice(j)];
}

/** Split seats across the template's decks (floor, then bed_upper, then B-prefix). */
function groupByDeck(seatRows: SeatRow[], wanted: number[]): SeatRow[][] | null {
  const cmp = <T extends string | number>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...seatRows].sort((a, b) => {
    const x = naturalKey(a.seatLabel);
    const y = naturalKey(b.seatLabel);
    return cmp(x[0], y[0]) || cmp(x[1], y[1]) || cmp(x[2], y[2]);
  });
  if (wanted.length === 1) return [sorted];
  const strategies: Array<(s: SeatRow) => number> = [
    (s) => (s.floor >= 2 ? 1 : 0),
    (s) => (s.seatClass === "bed_upper" ? 1 : 0),
    (s) => (s.seatLabel.trim().toUpperCase().startsWith("B") ? 1 : 0),
  ];
  for (const deckOf of strategies) {
    const groups: SeatRow[][] = Array.from({ length: wanted.length }, () => []);
    for (const s of sorted) groups[deckOf(s)].push(s);
    if (groups.every((g, i) => g.length === wanted[i])) return groups;
  }
  return null;
}

/**
 * Lay a template's cells over a layout's existing seats: the template
 * decides where each seat sits, the seats keep their identity (id and
 * label). Seats are matched to cells in natural label order, front to
 * back and left to right. Fails when the template's shape cannot hold
 * exactly these seats. PREVIEW ONLY — nothing is saved.
 */
export function fitToSeats(template: SeatPlan, seatRows: SeatRow[]): SeatPlan {
  const wanted = template.decks.map((d) => d.cells.filter((c) => isSellable(c.kind)).length);
  const total = wanted.reduce((a, b) => a + b, 0);
  if (total !== seatRows.length) {
    throw new Error(`template holds ${total} seats but the layout has ${seatRows.length}`);
  }
  const groups = groupByDeck(seatRows, wanted);
  if (!groups) throw new Error("cannot tell which seats belong to which deck");
  const plan: SeatPlan = JSON.parse(JSON.stringify(template));
  plan.decks.forEach((deck, i) => {
    const cells = deck.cells.filter((c) => isSellable(c.kind));
    cells.sort((a, b) => a.row - b.row || a.col - b.col);
    cells.forEach((cell, j) => {
      const seat = groups[i][j];
      cell.label = seat.seatLabel;
      cell.seatId = seat.id;
      if (seat.seatClass != null) cell.seatClass = seat.seatClass;
    });
  });
  return plan;
}

/** The layout's seat rows. */
export async function layoutSeats(layoutId: string): Promise<SeatRow[]> {
  const db = await getDb();
  return db.select().from(seats).where(eq(seats.busLayoutId, layoutId));
}

/** A layout is "in use" when the Rust `layout_in_use` says so: trips have
 * been materialized from its schedules, or any of its seats has live
 * inventory, or any is sold on a booking. (A schedule merely REFERENCING
 * the layout is not enough — the Rust original keeps such layouts
 * editable, and the editor lock follows that.) */
export async function layoutInUse(layoutId: string): Promise<boolean> {
  const db = await getDb();
  const seatIds = db.select({ id: seats.id }).from(seats).where(eq(seats.busLayoutId, layoutId));
  const scheduleIds = db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.busLayoutId, layoutId));
  const one = (rows: Array<{ n: number }>): number => {
    const r = rows[0];
    if (r === undefined) return 0;
    return Number(r.n);
  };
  const [trips, inventory, sold] = await Promise.all([
    db
      .select({ n: count() })
      .from(tripSessions)
      .where(inArray(tripSessions.scheduleId, scheduleIds)),
    db.select({ n: count() }).from(seatInventory).where(inArray(seatInventory.seatId, seatIds)),
    db.select({ n: count() }).from(bookingSeats).where(inArray(bookingSeats.seatId, seatIds)),
  ]);
  return one(trips) + one(inventory) + one(sold) > 0;
}

/**
 * Persist a plan + its seat diff atomically (Rust `apply_plan`):
 * deletes first, relabelled seats parked on a throwaway label so swaps
 * never collide (seat_label is UNIQUE per layout), then updates and
 * inserts, then the layout row (layout_data + total_seats).
 */
export async function applySeatPlan(
  layoutId: string,
  plan: SeatPlan,
  sync: SeatSync,
): Promise<number> {
  const db = await getDb();
  const oldById = new Map((await layoutSeats(layoutId)).map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const stmts: AtomicStatement[] = [];

  if (sync.deletes.length > 0) {
    stmts.push(db.delete(seats).where(inArray(seats.id, sync.deletes)));
  }
  // Park every relabelled seat on a throwaway label first.
  for (const { seatId, spec } of sync.updates) {
    const old = oldById.get(seatId);
    if (old && old.seatLabel !== spec.label) {
      stmts.push(
        db
          .update(seats)
          .set({ seatLabel: `~${seatId.slice(0, 8)}` })
          .where(eq(seats.id, seatId)),
      );
    }
  }
  for (const { seatId, spec } of sync.updates) {
    stmts.push(
      db
        .update(seats)
        .set({
          seatLabel: spec.label,
          seatClass: spec.seatClass,
          rowNum: spec.row,
          colNum: spec.col,
          floor: spec.floor,
          isWindow: spec.isWindow,
        })
        .where(eq(seats.id, seatId)),
    );
  }
  if (sync.inserts.length > 0) {
    const rows: Array<typeof seats.$inferInsert> = sync.inserts.map((spec) => ({
      id: crypto.randomUUID(),
      busLayoutId: layoutId,
      seatLabel: spec.label,
      seatClass: spec.seatClass,
      rowNum: spec.row,
      colNum: spec.col,
      isWindow: spec.isWindow,
      floor: spec.floor,
    }));
    // D1 batched insert — chunk to stay under the 100-bound-param ceiling:
    // each row binds 9 params (8 columns + the client-side $defaultFn
    // createdAt), so 11 rows = 99. 40 rows = 360 params failed every
    // layout above 11 seats with a 500.
    for (let i = 0; i < rows.length; i += 11) {
      stmts.push(db.insert(seats).values(rows.slice(i, i + 11)));
    }
  }
  const sellable = plan.decks.reduce(
    (n, d) => n + d.cells.filter((c) => isSellable(c.kind)).length,
    0,
  );
  stmts.push(
    db
      .update(busLayouts)
      .set({ totalSeats: sellable, layoutData: toStored(plan), updatedAt: now })
      .where(eq(busLayouts.id, layoutId)),
  );
  await atomicBatch(stmts);
  return sellable;
}

/** Full replace pipeline used by `PUT /api/admin/bus-layouts/{id}/plan`. */
export async function replaceSeatPlan(
  layoutId: string,
  plan: SeatPlan,
): Promise<{ sellable: number }> {
  const invalid = validateSeatPlan(plan);
  if (invalid) {
    const err = new Error(invalid) as Error & { statusCode?: number; code?: string };
    err.statusCode = 400;
    err.code = "validation";
    throw err;
  }
  const existing = await layoutSeats(layoutId);
  const inUse = await layoutInUse(layoutId);
  const sync = syncSeatRows(existing, plan, inUse); // throws InUseError → 409
  const sellable = await applySeatPlan(layoutId, plan, sync);
  // Seats may have changed class: what is still for sale follows the fares.
  const db = await getDb();
  const users = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.busLayoutId, layoutId));
  for (const sch of users) await repriceUpcoming(sch.id);
  return { sellable };
}
