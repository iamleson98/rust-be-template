/**
 * Loyalty — port of `loyalty_service.rs`. The balance is computed, never
 * stored: a user's completed bookings are the earning ledger (1 point per
 * 10,000 VND of each booking's total, floored per booking) and the tier is
 * a threshold band over that balance.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { bookings, brands, routes, schedules, tripSessions } from "@/lib/db/schema";

const POINT_RATE_VND = 10_000;
/** The panel shows the 20 newest earning events. */
const HISTORY_LIMIT = 20;
/** Completed bookings scanned for the balance (Rust `SCAN_LIMIT`). */
const SCAN_LIMIT = 500;

export interface LoyaltyTier {
  key: string;
  name: string;
  minPoints: number;
  benefitCodes: string[];
}

/** Ascending by `minPoints`; the last tier is unbounded. */
export const TIERS: readonly LoyaltyTier[] = [
  { key: "bronze", name: "Bronze", minPoints: 0, benefitCodes: ["earn_points", "redeem_voucher"] },
  { key: "silver", name: "Silver", minPoints: 1_000, benefitCodes: ["discount_5", "voucher_25k"] },
  {
    key: "gold",
    name: "Gold",
    minPoints: 5_000,
    benefitCodes: ["discount_10", "priority_seat", "voucher_60k"],
  },
  {
    key: "platinum",
    name: "Platinum",
    minPoints: 20_000,
    benefitCodes: ["discount_15", "priority_seat", "free_refund", "voucher_150k"],
  },
];

/** Index of the last tier whose `minPoints` the balance reaches. */
export function resolveTier(points: number): number {
  let idx = 0;
  TIERS.forEach((t, i) => {
    if (points >= t.minPoints) idx = i;
  });
  return idx;
}

export const pointsFor = (total: number): number => Math.floor(total / POINT_RATE_VND);

export interface LoyaltySummary {
  points: number;
  completedTrips: number;
  totalSpent: number;
  currency: string;
  tier: LoyaltyTier;
  nextTier?: LoyaltyTier;
  history: {
    bookingId: string;
    bookingCode: string;
    routeName?: string;
    brandName?: string;
    departureAt?: string;
    total: number;
    currency: string;
    points: number;
  }[];
}

/** `GET /api/loyalty`. */
export async function loyaltySummary(userId: string): Promise<LoyaltySummary> {
  const db = await getDb();
  const rows = await db
    .select({
      id: bookings.id,
      code: bookings.code,
      total: bookings.total,
      currency: bookings.currency,
      routeName: routes.name,
      brandName: brands.name,
      departureDate: tripSessions.departureDate,
      actualDepartureAt: tripSessions.actualDepartureAt,
      departureTime: schedules.departureTime,
    })
    .from(bookings)
    .leftJoin(tripSessions, eq(tripSessions.id, bookings.tripSessionId))
    .leftJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
    .leftJoin(routes, eq(routes.id, schedules.routeId))
    .leftJoin(brands, eq(brands.id, routes.brandId))
    .where(and(eq(bookings.userId, userId), eq(bookings.status, "completed")))
    .orderBy(desc(bookings.createdAt))
    .limit(SCAN_LIMIT);

  const points = rows.reduce((sum, b) => sum + pointsFor(b.total), 0);
  const idx = resolveTier(points);
  const next = TIERS[idx + 1];

  return {
    points,
    completedTrips: rows.length,
    totalSpent: rows.reduce((sum, b) => sum + b.total, 0),
    currency: rows[0]?.currency ?? "VND",
    tier: TIERS[idx]!,
    ...(next && { nextTier: next }),
    history: rows.slice(0, HISTORY_LIMIT).map((b) => {
      // The driver's recorded departure first, the scheduled one as fallback.
      const departureAt =
        b.actualDepartureAt ??
        (b.departureDate && b.departureTime ? `${b.departureDate}T${b.departureTime}` : null);
      return {
        bookingId: b.id,
        bookingCode: b.code,
        ...(b.routeName && { routeName: b.routeName }),
        ...(b.brandName && { brandName: b.brandName }),
        ...(departureAt && { departureAt }),
        total: b.total,
        currency: b.currency,
        points: pointsFor(b.total),
      };
    }),
  };
}
