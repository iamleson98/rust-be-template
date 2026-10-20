/**
 * What a seat costs — port of `fares.rs`.
 *
 * Each schedule prices its own seats, so the same vehicle can cost more on
 * one route than another. Standard seats, and seats of any class without a
 * fare of its own, cost `schedule.basePriceAdult`. A `schedule_fare` row
 * prices one other class (`vip`, `premium`, `bed_upper`, …).
 *
 * Child tickets are the brand's choice. When the brand sets `childMaxAge`,
 * passengers up to that age pay the class's child price if the schedule
 * sets one, and otherwise the adult price less `childDiscountAmount` (a
 * fixed amount of VND, never below 0). A child never pays more than an
 * adult.
 *
 * The server alone applies these rules: the passenger type a client sends
 * is ignored, only the age counts.
 */
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { scheduleFares, schedules, seatInventory, seats, tripSessions } from "@/lib/db/schema";
import { localToday } from "./trip-time";

/** The class of seats that have none. */
export const STANDARD = "standard";

/** A brand's child-ticket rule. */
export interface ChildPolicy {
  /** Passengers up to this age (inclusive) are children. */
  maxAge: number;
  /** VND off the adult price when the schedule sets no child price. */
  discountAmount: number;
}

/** The brand's policy; null when it sells no child tickets. */
export function childPolicyOf(
  brand: { childMaxAge: number | null; childDiscountAmount: number | null } | null | undefined,
): ChildPolicy | null {
  if (!brand || brand.childMaxAge == null) return null;
  return { maxAge: brand.childMaxAge, discountAmount: brand.childDiscountAmount ?? 0 };
}

/** The price of one seat class on one schedule. */
export interface Fare {
  adult: number;
  /** Overrides the brand's child discount. */
  child: number | null;
}

/** Every fare of one schedule. */
export interface FareTable {
  standard: Fare;
  classes: Map<string, Fare>;
}

export function fareTable(
  schedule: { basePriceAdult: number; basePriceChild: number | null },
  rows: Array<{ seatClass: string; priceAdult: number; priceChild: number | null }>,
): FareTable {
  return {
    standard: { adult: schedule.basePriceAdult, child: schedule.basePriceChild },
    classes: new Map(
      rows.map((r) => [r.seatClass, { adult: Number(r.priceAdult), child: r.priceChild }]),
    ),
  };
}

/** The fare of a seat of `cls`: its own, or the standard one. */
export function fareOf(table: FareTable, cls: string | null | undefined): Fare {
  return (cls ? table.classes.get(cls) : undefined) ?? table.standard;
}

/** A seat class as stored: trimmed and lower-case; null for standard. */
export function normalizeClass(cls: string | null | undefined): string | null {
  const c = cls?.trim().toLowerCase();
  return c && c !== STANDARD ? c : null;
}

/** The class a seat is priced and shown by. */
export function classOf(seat: { seatClass: string | null }): string {
  return normalizeClass(seat.seatClass) ?? STANDARD;
}

export type PassengerKind = "adult" | "child";

/**
 * What a child pays for a seat sold to adults at `adult` — the seat's
 * current price, which is the fare unless the trip was priced earlier.
 * Null when the brand sells no child tickets.
 */
export function childPrice(adult: number, fare: Fare, policy: ChildPolicy | null): number | null {
  if (!policy) return null;
  const price = fare.child ?? adult - policy.discountAmount;
  return Math.min(Math.max(price, 0), Math.max(adult, 0));
}

/** The ticket for a passenger of `age` in a seat sold to adults at `adult`. */
export function ticket(
  age: number,
  adult: number,
  fare: Fare,
  policy: ChildPolicy | null,
): { kind: PassengerKind; price: number } {
  const covered = policy && age <= policy.maxAge ? policy : null;
  const price = childPrice(adult, fare, covered);
  return price == null ? { kind: "adult", price: adult } : { kind: "child", price };
}

/**
 * Bring the seats still for sale on the schedule's upcoming trips in line
 * with its fares. Held and sold seats keep their price. Returns the number
 * of seats re-priced (Rust `reprice_upcoming`).
 */
export async function repriceUpcoming(scheduleId: string): Promise<number> {
  const db = await getDb();
  const schedule = (await db.select().from(schedules).where(eq(schedules.id, scheduleId)))[0];
  if (!schedule?.busLayoutId) return 0;
  const trips = await db
    .select({ id: tripSessions.id })
    .from(tripSessions)
    .where(
      and(eq(tripSessions.scheduleId, scheduleId), gte(tripSessions.departureDate, localToday())),
    );
  if (trips.length === 0) return 0;
  const layoutSeats = await db
    .select({ id: seats.id, seatClass: seats.seatClass })
    .from(seats)
    .where(eq(seats.busLayoutId, schedule.busLayoutId));
  const rows = await db
    .select()
    .from(scheduleFares)
    .where(eq(scheduleFares.scheduleId, scheduleId));
  const table = fareTable(schedule, rows);

  const byPrice = new Map<number, string[]>();
  for (const seat of layoutSeats) {
    const price = fareOf(table, classOf(seat)).adult;
    byPrice.set(price, [...(byPrice.get(price) ?? []), seat.id]);
  }
  const tripIds = trips.map((t) => t.id);
  const now = new Date().toISOString();
  let repriced = 0;
  // D1 caps bound parameters at 100 per statement.
  const CHUNK = 40;
  for (const [price, seatIds] of byPrice) {
    for (let t = 0; t < tripIds.length; t += CHUNK) {
      for (let s = 0; s < seatIds.length; s += CHUNK) {
        const res = await db
          .update(seatInventory)
          .set({ basePrice: price, finalPrice: price, updatedAt: now })
          .where(
            and(
              inArray(seatInventory.tripSessionId, tripIds.slice(t, t + CHUNK)),
              inArray(seatInventory.seatId, seatIds.slice(s, s + CHUNK)),
              eq(seatInventory.status, "available"),
              ne(seatInventory.finalPrice, price),
            ),
          )
          .run();
        repriced += res.meta.changes;
      }
    }
  }
  return repriced;
}
