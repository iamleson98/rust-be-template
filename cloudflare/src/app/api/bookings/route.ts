import { getDb } from "@/lib/db/client";
import { bookings } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { handleRouteError, requireUser, readJson } from "@/lib/api";
import { createBooking, type HoldRequest } from "@/lib/services/booking";

/** GET /api/bookings — own tickets (placed/confirmed only), newest first. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const db = await getDb();
    const rows = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, user.id),
          inArray(bookings.status, ["pending", "confirmed"]),
        ),
      )
      .orderBy(desc(bookings.createdAt))
      .limit(50);
    return Response.json({
      items: rows.map((b) => ({
        id: b.id,
        code: b.code,
        status: b.status,
        total: b.total,
        adultCount: b.adultCount,
        childCount: b.childCount,
        tripSessionId: b.tripSessionId,
        contactName: b.contactName,
        contactPhone: b.contactPhone,
        paymentMethod: b.paymentMethod,
        expiresAt: b.expiresAt,
        createdAt: b.createdAt,
      })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** POST /api/bookings — hold seats → pending booking (TTL 10/20 min). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await readJson<HoldRequest>(req);
    const result = await createBooking(user.id, body);
    return Response.json(
      {
        booking: {
          id: result.booking.id,
          code: result.booking.code,
          status: result.booking.status,
          subtotal: result.booking.subtotal,
          discount: result.booking.discount,
          total: result.booking.total,
          expiresAt: result.booking.expiresAt,
        },
        seats: result.seats,
        trip: result.trip,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
