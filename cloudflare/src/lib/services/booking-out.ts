/**
 * BookingOut serializer — assembles the SPA SDK's flat `BookingOut`
 * (port of the Rust `booking_service` views): booking row + seat tickets
 * + trip preview + review + boarding QR + cancellation window.
 */
import { getDb, type Database } from "@/lib/db/client";
import { bookings, bookingSeats, seats, reviews, tripSessions, schedules, routes, brands, busLayouts } from "@/lib/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { findCity } from "@/lib/services/trip-search";

type BookingRow = typeof bookings.$inferSelect;

export interface BookingOut {
  id: string;
  code: string;
  status: string;
  paymentMethod?: string;
  adultCount: number;
  childCount: number;
  subtotal: number;
  discount: number;
  fees: number;
  total: number;
  currency: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  pickup?: { name: string; address?: string | null; lat?: number | null; lon?: number | null } | null;
  dropoff?: { name: string; address?: string | null; lat?: number | null; lon?: number | null } | null;
  seats: Array<{
    seatId?: string;
    seatCode?: string;
    seatClass?: string;
    passengerName?: string;
    passengerType?: string;
    passengerAge?: number;
    price?: number;
  }>;
  trip?: {
    id: string;
    departureDate: string;
    departureTime?: string;
    departureAt?: string;
    status: string;
    routeId: string;
    routeName: string;
    fromName?: string;
    toName?: string;
    brandId?: string;
    brandName?: string;
    brandLogo?: string;
    busLayoutName?: string;
  };
  review?: {
    id: string;
    rating: number;
    title?: string | null;
    content?: string | null;
    tags: string[];
    photos: string[];
    createdAt: string;
  };
  canCancel: boolean;
  ticketQr?: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Tiny QR SVG generator — byte mode, ECC L, without external deps. */
async function ticketQrSvg(payload: string): Promise<string> {
  try {
    const QR = (await import("qrcode")).default;
    const svg = await QR.toString(payload, { type: "svg", margin: 1, width: 220 });
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return undefined as unknown as string;
  }
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Full `BookingOut` for one booking row (optionally with the boarding QR). */
export async function bookingOut(booking: BookingRow, opts: { withQr?: boolean } = {}): Promise<BookingOut> {
  const db = await getDb();
  const tripRow = (
    await db
      .select({ trip: tripSessions, schedule: schedules, route: routes, brand: brands, layout: busLayouts })
      .from(tripSessions)
      .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
      .innerJoin(routes, eq(routes.id, schedules.routeId))
      .leftJoin(brands, eq(brands.id, routes.brandId))
      .leftJoin(busLayouts, eq(busLayouts.id, schedules.busLayoutId))
      .where(eq(tripSessions.id, booking.tripSessionId))
      .limit(1)
  )[0];

  const seatRows = await db
    .select({ bs: bookingSeats, seat: seats })
    .from(bookingSeats)
    .leftJoin(seats, eq(seats.id, bookingSeats.seatId))
    .where(eq(bookingSeats.bookingId, booking.id));

  const reviewRow = (
    await db.select().from(reviews).where(eq(reviews.bookingId, booking.id)).limit(1)
  )[0];

  const depIso = tripRow
    ? `${tripRow.trip.departureDate}T${tripRow.schedule.departureTime}:00`
    : null;
  const departed = depIso ? Date.now() > new Date(`${depIso}+07:00`).getTime() : false;
  const open = booking.status === "pending" || booking.status === "confirmed";
  const canCancel = open && !departed;

  const parseArr = (v: string | null) => {
    if (!v) return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  const out: BookingOut = {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    paymentMethod: booking.paymentMethod ?? undefined,
    adultCount: booking.adultCount,
    childCount: booking.childCount,
    subtotal: booking.subtotal,
    discount: booking.discount,
    fees: booking.fees,
    total: booking.total,
    currency: booking.currency,
    contactName: booking.contactName,
    contactPhone: booking.contactPhone,
    contactEmail: booking.contactEmail,
    pickup: booking.pickupName
      ? {
          name: booking.pickupName,
          address: booking.pickupAddress,
          lat: num(booking.pickupLat),
          lon: num(booking.pickupLon),
        }
      : null,
    dropoff: booking.dropoffName
      ? {
          name: booking.dropoffName,
          address: booking.dropoffAddress,
          lat: num(booking.dropoffLat),
          lon: num(booking.dropoffLon),
        }
      : null,
    seats: seatRows.map(({ bs, seat }) => ({
      seatId: bs.seatId ?? undefined,
      seatCode: seat?.seatLabel ?? undefined,
      seatClass: seat?.seatClass ?? undefined,
      passengerName: bs.passengerName ?? undefined,
      passengerType: bs.passengerType ?? undefined,
      passengerAge: bs.passengerAge ?? undefined,
      price: bs.price != null ? Number(bs.price) : undefined,
    })),
    trip: tripRow
      ? {
          id: tripRow.trip.id,
          departureDate: tripRow.trip.departureDate,
          departureTime: tripRow.schedule.departureTime,
          departureAt: depIso ?? undefined,
          status: tripRow.trip.status,
          routeId: tripRow.route.id,
          routeName: tripRow.route.name,
          fromName: findCity(tripRow.route.startLocationId)?.name,
          toName: findCity(tripRow.route.endLocationId)?.name,
          brandId: tripRow.route.brandId ?? undefined,
          brandName: tripRow.brand?.name ?? undefined,
          brandLogo: tripRow.brand?.logoUrl ?? undefined,
          busLayoutName: tripRow.layout?.name ?? undefined,
        }
      : undefined,
    review: reviewRow
      ? {
          id: reviewRow.id,
          rating: reviewRow.rating,
          title: reviewRow.title,
          content: reviewRow.content,
          tags: parseArr(reviewRow.tags),
          photos: parseArr(reviewRow.photos),
          createdAt: reviewRow.createdAt,
        }
      : undefined,
    canCancel,
    expiresAt: booking.expiresAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
  if (opts.withQr && open) out.ticketQr = await ticketQrSvg(booking.code);
  return out;
}

/** Load one booking row by id or code (optionally scoped to a user). */
export async function loadBooking(
  idOrCode: string,
  userId?: string | null,
): Promise<BookingRow | null> {
  const db = await getDb();
  const scope = userId ? sql`AND ${bookings.userId} = ${userId}` : sql``;
  const row = (
    await db
      .select()
      .from(bookings)
      .where(sql`(${bookings.id} = ${idOrCode} OR LOWER(${bookings.code}) = LOWER(${idOrCode})) ${scope}`)
      .limit(1)
  )[0];
  return row ?? null;
}

/** Booking rows for a user (or all, staff view), newest first. */
export async function loadBookings(
  userId?: string | null,
  limit = 50,
  offset = 0,
  filters: { status?: string; search?: string; dateFrom?: string; dateTo?: string } = {},
): Promise<BookingRow[]> {
  const db = await getDb();
  const conds: SQL[] = [];
  if (userId) conds.push(eq(bookings.userId, userId));
  if (filters.status) conds.push(eq(bookings.status, filters.status));
  if (filters.search) conds.push(sql`(${bookings.code} LIKE ${"%" + filters.search + "%"} OR ${bookings.contactName} LIKE ${"%" + filters.search + "%"})`);
  if (filters.dateFrom) conds.push(sql`${bookings.createdAt} >= ${filters.dateFrom}`);
  if (filters.dateTo) conds.push(sql`${bookings.createdAt} <= ${filters.dateTo + "T23:59:59"}`);
  const rows = await db
    .select()
    .from(bookings)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${bookings.createdAt} DESC`)
    .limit(limit)
    .offset(offset);
  return rows;
}

export type { Database };
