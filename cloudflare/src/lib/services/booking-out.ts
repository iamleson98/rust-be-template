/**
 * Bookings as customers and staff see them — port of `booking_view.rs`.
 *
 * One serializer for every listing and detail view: it loads what a page of
 * bookings refers to (trips, schedules, routes, brands, layouts, seats,
 * reviews) in a fixed number of queries, whatever the page size.
 */
import { getDb, type Database } from "@/lib/db/client";
import {
  bookings,
  bookingSeats,
  brands,
  busLayouts,
  pickupPoints,
  reviews,
  routes,
  schedules,
  seats,
  tripSessions,
} from "@/lib/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { findCity } from "@/lib/city-match";
import { departureInstant, rfc3339 } from "./trip-time";

type BookingRow = typeof bookings.$inferSelect;

interface StopOut {
  name: string;
  address?: string;
  lat?: number;
  lon?: number;
}

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
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  pickup?: StopOut;
  dropoff?: StopOut;
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
    title?: string;
    content?: string;
    tags: string[];
    photos: string[];
    createdAt: string;
  };
  canCancel: boolean;
  ticketQr?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

// D1 allows 100 bound parameters per statement.
const IN_CHUNK = 90;

const unique = <T>(items: T[]): T[] => [...new Set(items)];

async function inChunks<T>(ids: string[], load: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK)
    out.push(...(await load(ids.slice(i, i + IN_CHUNK))));
  return out;
}

const orUndefined = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

const parseArr = (v: string | null): string[] => {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const num = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** `bookings` as `BookingOut`, in the same order. */
export async function bookingViews(rows: BookingRow[]): Promise<BookingOut[]> {
  if (rows.length === 0) return [];
  const db = await getDb();

  const trips = new Map(
    (
      await inChunks(unique(rows.map((b) => b.tripSessionId)), (part) =>
        db.select().from(tripSessions).where(inArray(tripSessions.id, part)),
      )
    ).map((t) => [t.id, t]),
  );
  const scheduleMap = new Map(
    (
      await inChunks(unique([...trips.values()].map((t) => t.scheduleId)), (part) =>
        db.select().from(schedules).where(inArray(schedules.id, part)),
      )
    ).map((s) => [s.id, s]),
  );
  const routeMap = new Map(
    (
      await inChunks(unique([...scheduleMap.values()].map((s) => s.routeId)), (part) =>
        db.select().from(routes).where(inArray(routes.id, part)),
      )
    ).map((r) => [r.id, r]),
  );
  const brandMap = new Map(
    (
      await inChunks(
        unique([...routeMap.values()].flatMap((r) => (r.brandId ? [r.brandId] : []))),
        (part) => db.select().from(brands).where(inArray(brands.id, part)),
      )
    ).map((b) => [b.id, b]),
  );
  const layoutMap = new Map(
    (
      await inChunks(
        unique([...scheduleMap.values()].flatMap((s) => (s.busLayoutId ? [s.busLayoutId] : []))),
        (part) => db.select().from(busLayouts).where(inArray(busLayouts.id, part)),
      )
    ).map((l) => [l.id, l]),
  );

  const bookingIds = rows.map((b) => b.id);
  const tickets = await inChunks(bookingIds, (part) =>
    db.select().from(bookingSeats).where(inArray(bookingSeats.bookingId, part)),
  );
  const seatMap = new Map(
    (
      await inChunks(unique(tickets.map((t) => t.seatId)), (part) =>
        db.select().from(seats).where(inArray(seats.id, part)),
      )
    ).map((s) => [s.id, s]),
  );
  const reviewMap = new Map(
    (
      await inChunks(bookingIds, (part) =>
        db.select().from(reviews).where(inArray(reviews.bookingId, part)),
      )
    ).flatMap((r) => (r.bookingId ? [[r.bookingId, r] as const] : [])),
  );

  // Bookings sold before stops were copied onto them still name their
  // route pickup points by id.
  const legacyIds = unique(
    rows
      .filter((b) => !b.pickupName || !b.dropoffName)
      .flatMap((b) => [b.boardingPointId, b.droppingPointId])
      .filter((id): id is string => !!id),
  );
  const legacyPoints = new Map(
    (
      await inChunks(legacyIds, (part) =>
        db.select().from(pickupPoints).where(inArray(pickupPoints.id, part)),
      )
    ).map((p) => [p.id, p]),
  );
  const legacyStop = (id: string | null): StopOut | undefined => {
    const p = id ? legacyPoints.get(id) : undefined;
    if (!p?.name) return undefined;
    return {
      name: p.name,
      address: orUndefined(p.address),
      lat: orUndefined(p.lat),
      lon: orUndefined(p.lon),
    };
  };
  const cityStop = (slug: string | undefined): StopOut | undefined => {
    const c = slug ? findCity(slug) : null;
    return c ? { name: c.name, lat: c.lat, lon: c.lon } : undefined;
  };
  const now = Date.now();

  return rows.map((b) => {
    const trip = trips.get(b.tripSessionId);
    const schedule = trip ? scheduleMap.get(trip.scheduleId) : undefined;
    const route = schedule ? routeMap.get(schedule.routeId) : undefined;
    const brand = route?.brandId ? brandMap.get(route.brandId) : undefined;
    const from = route ? findCity(route.startLocationId) : null;
    const to = route ? findCity(route.endLocationId) : null;
    const departsAt =
      trip && schedule
        ? departureInstant(trip.departureDate, schedule.departureTime, trip.actualDepartureAt)
        : null;
    const departed = departsAt != null && departsAt.getTime() <= now;

    const pickup: StopOut | undefined = b.pickupName
      ? {
          name: b.pickupName,
          address: orUndefined(b.pickupAddress),
          lat: num(b.pickupLat),
          lon: num(b.pickupLon),
        }
      : (legacyStop(b.boardingPointId) ?? cityStop(route?.startLocationId));
    const dropoff: StopOut | undefined = b.dropoffName
      ? {
          name: b.dropoffName,
          address: orUndefined(b.dropoffAddress),
          lat: num(b.dropoffLat),
          lon: num(b.dropoffLon),
        }
      : (legacyStop(b.droppingPointId) ?? cityStop(route?.endLocationId));

    const seatsOut = tickets
      .filter((t) => t.bookingId === b.id)
      .map((t) => {
        const seat = seatMap.get(t.seatId);
        return {
          seatId: t.seatId,
          seatCode: orUndefined(seat?.seatLabel),
          seatClass: orUndefined(seat?.seatClass),
          passengerName: orUndefined(t.passengerName),
          passengerType: orUndefined(t.passengerType),
          passengerAge: orUndefined(t.passengerAge),
          price: Number(t.price),
        };
      })
      // Rust sorts by the (optional) seat code; byte order, absent first.
      .sort((x, y) => {
        const a = x.seatCode ?? "";
        const c = y.seatCode ?? "";
        if (x.seatCode == null && y.seatCode != null) return -1;
        if (x.seatCode != null && y.seatCode == null) return 1;
        return a < c ? -1 : a > c ? 1 : 0;
      });

    const r = reviewMap.get(b.id);
    return {
      id: b.id,
      code: b.code,
      status: b.status,
      paymentMethod: orUndefined(b.paymentMethod),
      adultCount: b.adultCount,
      childCount: b.childCount,
      subtotal: b.subtotal,
      discount: b.discount,
      fees: b.fees,
      total: b.total,
      currency: b.currency,
      contactName: orUndefined(b.contactName),
      contactPhone: orUndefined(b.contactPhone),
      contactEmail: orUndefined(b.contactEmail),
      pickup,
      dropoff,
      seats: seatsOut,
      trip:
        trip && schedule && route
          ? {
              id: trip.id,
              departureDate: trip.departureDate,
              departureTime: schedule.departureTime,
              departureAt: departsAt ? rfc3339(departsAt) : undefined,
              status: trip.status,
              routeId: route.id,
              routeName: route.name,
              fromName: orUndefined(from?.name),
              toName: orUndefined(to?.name),
              brandId: orUndefined(route.brandId),
              brandName: orUndefined(brand?.name),
              brandLogo: orUndefined(brand?.logoUrl),
              busLayoutName: orUndefined(
                schedule.busLayoutId ? layoutMap.get(schedule.busLayoutId)?.name : null,
              ),
            }
          : undefined,
      review: r
        ? {
            id: r.id,
            rating: r.rating,
            title: orUndefined(r.title),
            content: orUndefined(r.content),
            tags: parseArr(r.tags),
            photos: parseArr(r.photos),
            createdAt: r.createdAt,
          }
        : undefined,
      canCancel: (b.status === "pending" || b.status === "confirmed") && !departed,
      expiresAt: orUndefined(b.expiresAt),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  });
}

/** The boarding QR of a ticket: its code, as an SVG data URI. */
async function ticketQr(code: string): Promise<string | undefined> {
  try {
    const QR = (await import("qrcode")).default;
    const svg = await QR.toString(code, { type: "svg", margin: 4, width: 240 });
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return undefined;
  }
}

/** One booking as `BookingOut`, with its boarding QR while it is open. */
export async function bookingView(booking: BookingRow): Promise<BookingOut> {
  const [view] = await bookingViews([booking]);
  if (view.status === "pending" || view.status === "confirmed")
    view.ticketQr = await ticketQr(view.code);
  return view;
}

// ── Listings ─────────────────────────────────────────────────────

/** Which bookings a listing returns, and in what order. Every field narrows it. */
export interface BookingFilter {
  userId?: string;
  status?: string;
  paymentMethod?: string;
  /** Only tickets: bookings placed for payment or already confirmed, not checkouts left unfinished. */
  placed?: boolean;
  /** Code, contact name or contact phone contains this. */
  search?: string;
  brandId?: string;
  routeId?: string;
  /** Created at or after this instant (ISO, ms precision like stored timestamps). */
  createdFrom?: string;
  /** Created before this instant. */
  createdBefore?: string;
  order?: "newest" | "oldest" | "total_desc" | "total_asc";
}

function filterWhere(db: Database, f: BookingFilter): SQL | undefined {
  const search = f.search?.trim();
  const tripsOf = (cond: SQL) =>
    db
      .select({ id: tripSessions.id })
      .from(tripSessions)
      .innerJoin(schedules, eq(schedules.id, tripSessions.scheduleId))
      .innerJoin(routes, eq(routes.id, schedules.routeId))
      .where(cond);
  return and(
    f.userId ? eq(bookings.userId, f.userId) : undefined,
    f.status ? eq(bookings.status, f.status) : undefined,
    f.paymentMethod ? eq(bookings.paymentMethod, f.paymentMethod) : undefined,
    f.placed
      ? or(isNotNull(bookings.paymentMethod), inArray(bookings.status, ["confirmed", "completed"]))
      : undefined,
    search
      ? or(
          like(bookings.code, `%${search.toUpperCase()}%`),
          like(bookings.contactName, `%${search}%`),
          like(bookings.contactPhone, `%${search}%`),
        )
      : undefined,
    f.routeId ? inArray(bookings.tripSessionId, tripsOf(eq(routes.id, f.routeId))) : undefined,
    f.brandId ? inArray(bookings.tripSessionId, tripsOf(eq(routes.brandId, f.brandId))) : undefined,
    f.createdFrom ? gte(bookings.createdAt, f.createdFrom) : undefined,
    f.createdBefore ? lt(bookings.createdAt, f.createdBefore) : undefined,
  );
}

/** A page of the bookings matching `filter`, in its order. */
export async function listBookings(
  filter: BookingFilter,
  limit: number,
  offset: number,
): Promise<BookingRow[]> {
  const db = await getDb();
  const order =
    filter.order === "oldest"
      ? asc(bookings.createdAt)
      : filter.order === "total_desc"
        ? desc(bookings.total)
        : filter.order === "total_asc"
          ? asc(bookings.total)
          : desc(bookings.createdAt);
  return db
    .select()
    .from(bookings)
    .where(filterWhere(db, filter))
    .orderBy(order)
    .limit(limit)
    .offset(offset);
}

/** How many bookings match `filter`. */
export async function countBookings(filter: BookingFilter): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(bookings)
    .where(filterWhere(db, filter));
  return Number(rows[0]?.n ?? 0);
}

/** `(createdAt, status, total)` of every booking matching `filter`: what reports aggregate. */
export async function bookingFacts(
  filter: BookingFilter,
): Promise<Array<{ createdAt: string; status: string; total: number }>> {
  const db = await getDb();
  return db
    .select({ createdAt: bookings.createdAt, status: bookings.status, total: bookings.total })
    .from(bookings)
    .where(filterWhere(db, filter));
}
