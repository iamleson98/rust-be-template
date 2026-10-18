import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireUser } from "@/lib/api";

/**
 * `GET /api/loyalty` — the authenticated user's loyalty summary.
 * Port of the Rust `LoyaltyService`: points are COMPUTED from completed
 * bookings (1 point per 10,000 VND, floored per booking), tiers are
 * threshold bands, history = 20 newest earning events.
 */
const POINT_RATE_VND = 10_000;
const HISTORY_LIMIT = 20;
const TIERS: Array<{ key: string; name: string; minPoints: number; benefitCodes: string[] }> = [
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

const tierOut = (i: number) => TIERS[i];

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const rows = await rawAll<{
      id: string;
      code: string;
      total: number;
      currency: string;
      created_at: string;
      trip_session_id: string | null;
      route_name: string | null;
      brand_name: string | null;
      departure_date: string | null;
      departure_time: string | null;
    }>(sql`
      SELECT b.id, b.code, b.total, b.currency, b.created_at,
             b.trip_session_id,
             r.name AS route_name, br.name AS brand_name,
             ts.departure_date, s.departure_time
      FROM booking b
      LEFT JOIN trip_session ts ON ts.id = b.trip_session_id
      LEFT JOIN schedule s ON s.id = ts.schedule_id
      LEFT JOIN route r ON r.id = s.route_id
      LEFT JOIN brand br ON br.id = r.brand_id
      WHERE b.user_id = ${user.id} AND b.status = 'completed'
      ORDER BY b.created_at DESC
      LIMIT 500
    `);

    let points = 0;
    let totalSpent = 0;
    for (const b of rows) {
      points += Math.floor(b.total / POINT_RATE_VND);
      totalSpent += b.total;
    }
    let idx = 0;
    TIERS.forEach((t, i) => {
      if (points >= t.minPoints) idx = i;
    });

    const history = rows.slice(0, HISTORY_LIMIT).map((b) => ({
      bookingId: b.id,
      bookingCode: b.code,
      points: Math.floor(b.total / POINT_RATE_VND),
      total: b.total,
      currency: b.currency,
      routeName: b.route_name,
      brandName: b.brand_name,
      departureAt:
        b.departure_date && b.departure_time ? `${b.departure_date}T${b.departure_time}:00` : null,
    }));

    return Response.json({
      points,
      completedTrips: rows.length,
      totalSpent,
      currency: rows[0]?.currency ?? "VND",
      tier: tierOut(idx),
      nextTier: idx + 1 < TIERS.length ? tierOut(idx + 1) : null,
      history,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
