/**
 * `GET /api/recommendations` — port of `PublicService::recommendations`: up
 * to four upcoming trips with seats left, for the home page carousel.
 */
import { and, asc, eq, gt, gte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { routes, schedules, tripSessions } from "@/lib/db/schema";
import { buildCards, type Candidate } from "./trip-cards";
import { onSale } from "./public-format";
import type { TripCard } from "./trip-results";
import { localToday } from "./trip-time";
import { INLINE_FILL_BUDGET_MS, fillInline, sellWindow } from "./trip-warmer";

/** Trips the homepage shows, and how many upcoming ones it looks at to find them. */
const RECOMMENDATIONS = 4;
const RECOMMENDATION_CANDIDATES = 16;
/** A cold database is filled this many days ahead, today first. */
const SELF_HEAL_DAYS = 7;

/** Scheduled trips from `today` with seats left, soonest first. */
async function upcoming(today: string): Promise<Candidate[]> {
  const db = await getDb();
  return db
    .select({ trip: tripSessions, schedule: schedules, route: routes })
    .from(tripSessions)
    .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
    .innerJoin(routes, eq(routes.id, schedules.routeId))
    .where(
      and(
        gte(tripSessions.departureDate, today),
        gt(tripSessions.availableSeats, 0),
        eq(tripSessions.status, "scheduled"),
      ),
    )
    .orderBy(asc(tripSessions.departureDate), asc(schedules.departureTime))
    .limit(RECOMMENDATION_CANDIDATES);
}

/**
 * Self-healing homepage: with no upcoming trip at all, fill the next days
 * from every schedule — within the inline budget, today first.
 */
async function fillColdDatabase(today: string): Promise<void> {
  const db = await getDb();
  const all = await db.select().from(schedules);
  const deadline = Date.now() + INLINE_FILL_BUDGET_MS;
  for (const date of sellWindow(today, SELF_HEAL_DAYS)) {
    await fillInline(all, date, deadline);
    if (Date.now() >= deadline) break;
  }
}

export async function recommendedTrips(): Promise<{ items: TripCard[] }> {
  const today = localToday();
  let candidates = await upcoming(today);
  if (candidates.length === 0) {
    await fillColdDatabase(today);
    candidates = await upcoming(today);
  }
  const sellable = candidates.filter((c) => onSale(c.trip, c.schedule)).slice(0, RECOMMENDATIONS);
  return { items: (await buildCards(sellable)).map((b) => b.card) };
}
