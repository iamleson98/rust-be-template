/**
 * Reviews — port of `review_service.rs`, `dto/review.rs`, the review
 * parts of `admin_service/reviews.rs` and `store/review.rs`.
 *
 * Moderation statuses are `pending | approved | rejected | hidden`; only
 * `approved` rows are public, and a brand's stored rating follows its
 * approved reviews (an imported rating stays until the first one exists).
 */
import { and, asc, count, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { bookings, brands, reviews, routes, schedules, tripSessions } from "@/lib/db/schema";
import { departureInstant, localToday } from "@/lib/services/trip-time";
import { invalidateBrands, invalidateReviews } from "@/lib/services/lookups";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  uuidParam,
  validPhone,
} from "@/lib/services/http-errors";

type ReviewRow = typeof reviews.$inferSelect;

export const REVIEW_STATUSES = ["pending", "approved", "rejected", "hidden"] as const;
const MAX_CONTENT_CHARS = 5000;
const MAX_PAGE = 200;

// ── DTO ─────────────────────────────────────────────────────────

/**
 * `ReviewOut`: absent fields are omitted (serde `skip_serializing_if`), and
 * empty `tags` / `photos` are left out too.
 */
export interface ReviewOut {
  id: string;
  bookingId?: string;
  tripSessionId?: string;
  routeId?: string;
  brandId?: string;
  authorName?: string;
  authorPhone?: string;
  rating: number;
  title?: string;
  content?: string;
  tags?: string[];
  photos?: string[];
  status: string;
  helpfulCount: number;
  reply?: string;
  repliedAt?: string;
  createdAt: string;
  updatedAt: string;
  userId?: string;
}

/** Tags are stored comma-joined by Rust; reviews the port wrote earlier hold a JSON array. */
export function parseTags(raw: string | null, trim = false): string[] {
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter((t) => t !== "");
    } catch {
      // not JSON after all: a tag list that happens to start with "["
    }
  }
  const parts = raw.split(",").map((t) => (trim ? t.trim() : t));
  return parts.filter((t) => t !== "");
}

function parsePhotos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string")
      ? (parsed as string[])
      : [];
  } catch {
    return [];
  }
}

/** Rust `review_to_dto`. */
export function reviewOut(r: ReviewRow): ReviewOut {
  const tags = parseTags(r.tags);
  const photos = parsePhotos(r.photos);
  return {
    id: r.id,
    ...(r.bookingId && { bookingId: r.bookingId }),
    ...(r.tripSessionId && { tripSessionId: r.tripSessionId }),
    ...(r.routeId && { routeId: r.routeId }),
    ...(r.brandId && { brandId: r.brandId }),
    ...(r.authorName !== null && { authorName: r.authorName }),
    ...(r.authorPhone !== null && { authorPhone: r.authorPhone }),
    rating: r.rating,
    ...(r.title !== null && { title: r.title }),
    ...(r.content !== null && { content: r.content }),
    ...(tags.length > 0 && { tags }),
    ...(photos.length > 0 && { photos }),
    status: r.status,
    helpfulCount: r.helpfulCount,
    ...(r.reply !== null && { reply: r.reply }),
    ...(r.repliedAt !== null && { repliedAt: r.repliedAt }),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(r.userId && { userId: r.userId }),
  };
}

/** `ReviewOut::public`: the author's phone stays with the author and the staff. */
export function publicReview(r: ReviewRow): ReviewOut {
  const { authorPhone: _phone, ...rest } = reviewOut(r);
  return rest;
}

// ── Queries ─────────────────────────────────────────────────────

export interface ReviewFilter {
  brandId?: string | null;
  routeId?: string | null;
  userId?: string | null;
  status?: string | null;
  search?: string | null;
}

/** Rust `apply_review_filters` + `apply_review_search`; a malformed id is ignored by the store. */
function reviewWhere(f: ReviewFilter): SQL | undefined {
  const term = f.search?.trim();
  const pattern = term ? `%${term}%` : null;
  return and(
    f.brandId ? eq(reviews.brandId, f.brandId) : undefined,
    f.routeId ? eq(reviews.routeId, f.routeId) : undefined,
    f.userId ? eq(reviews.userId, f.userId) : undefined,
    f.status ? eq(reviews.status, f.status) : undefined,
    pattern
      ? or(
          like(reviews.authorName, pattern),
          like(reviews.authorPhone, pattern),
          like(reviews.title, pattern),
          like(reviews.content, pattern),
        )
      : undefined,
  );
}

async function listRows(filter: ReviewFilter, limit: number, offset: number): Promise<ReviewRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(reviews)
    .where(reviewWhere(filter))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);
}

async function countRows(filter: ReviewFilter): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ n: count() }).from(reviews).where(reviewWhere(filter));
  return rows[0]?.n ?? 0;
}

/** `GET /api/reviews`: approved reviews only, the phone left out. */
export async function listPublicReviews(opts: {
  brandId: string | null;
  routeId: string | null;
  limit: number;
  offset: number;
}): Promise<{ items: ReviewOut[] }> {
  const rows = await listRows(
    { brandId: opts.brandId, routeId: opts.routeId, status: "approved" },
    Math.min(opts.limit, MAX_PAGE),
    opts.offset,
  );
  return { items: rows.map(publicReview) };
}

/** `GET /api/reviews/mine`: the caller's own reviews with a true total. */
export async function listMyReviews(
  userId: string,
  status: string | null,
  rawLimit: number,
  offset: number,
) {
  const limit = Math.min(Math.max(rawLimit, 1), MAX_PAGE);
  const filter = { userId, status };
  const [total, rows] = await Promise.all([countRows(filter), listRows(filter, limit, offset)]);
  return { items: rows.map(reviewOut), total, limit, offset };
}

/** `GET /api/admin/reviews`. */
export async function listAdminReviews(filter: ReviewFilter, rawLimit: number, offset: number) {
  const limit = Math.min(Math.max(rawLimit, 1), MAX_PAGE);
  const [total, rows] = await Promise.all([countRows(filter), listRows(filter, limit, offset)]);
  return { items: rows.map(reviewOut), total, limit, offset };
}

export async function findReview(id: string): Promise<ReviewRow | undefined> {
  const db = await getDb();
  return (await db.select().from(reviews).where(eq(reviews.id, id)).limit(1))[0];
}

/** `GET /api/reviews/{id}`: an approved review; anything else is "not found". */
export async function getPublicReview(id: string): Promise<ReviewOut> {
  const review = await findReview(id);
  if (!review || review.status !== "approved") throw notFound("review not found");
  return publicReview(review);
}

// ── Stats and tags ──────────────────────────────────────────────

export interface ReviewStats {
  count: number;
  average?: number;
  byRating: number[];
  topTags: { tag: string; count: number }[];
}

/** Rust `ReviewStats::tally`: ratings outside 1–5 are ignored. */
export function tallyReviews(rows: { rating: number; tags: string | null }[]): ReviewStats {
  const byRating = [0, 0, 0, 0, 0];
  const tagCounts = new Map<string, number>();
  let total = 0;
  let sum = 0;
  for (const { rating, tags } of rows) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    byRating[rating - 1]! += 1;
    total += 1;
    sum += rating;
    for (const tag of parseTags(tags, true)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts]
    .map(([tag, n]) => ({ tag, count: n }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, 5);
  return { count: total, ...(total > 0 && { average: sum / total }), byRating, topTags };
}

/** `GET /api/reviews/stats`: brand and route filters combine (both must match). */
export async function reviewStats(brandId: string | null, routeId: string | null) {
  if (!brandId && !routeId) throw badRequest("brand_id or route_id is required");
  const db = await getDb();
  const rows = await db
    .select({ rating: reviews.rating, tags: reviews.tags })
    .from(reviews)
    .where(
      and(
        eq(reviews.status, "approved"),
        brandId ? eq(reviews.brandId, brandId) : undefined,
        routeId ? eq(reviews.routeId, routeId) : undefined,
      ),
    );
  return tallyReviews(rows);
}

/** `GET /api/reviews/tags`: every distinct tag of the approved reviews, sorted. */
export async function approvedReviewTags(): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ tags: reviews.tags })
    .from(reviews)
    .where(and(eq(reviews.status, "approved"), sql`${reviews.tags} IS NOT NULL`));
  const tags = new Set<string>();
  for (const { tags: raw } of rows) for (const tag of parseTags(raw, true)) tags.add(tag);
  return [...tags].sort();
}

// ── Brand rating ────────────────────────────────────────────────

/** The mean of a brand's approved reviews; null while it has none. */
async function approvedAverage(db: Database, brandId: string): Promise<number | null> {
  const row = (
    await db
      .select({ n: count(), sum: sql<number>`COALESCE(SUM(${reviews.rating}), 0)` })
      .from(reviews)
      .where(and(eq(reviews.brandId, brandId), eq(reviews.status, "approved")))
  )[0];
  return row && row.n > 0 ? Number(row.sum) / row.n : null;
}

/**
 * Rust `recompute_brand_rating`: a brand with no approved review keeps its
 * stored (imported) rating; otherwise the rating becomes their mean.
 */
export async function recomputeBrandRating(brandId: string): Promise<void> {
  const db = await getDb();
  const avg = await approvedAverage(db, brandId);
  if (avg === null) return;
  await db.update(brands).set({ rating: avg }).where(eq(brands.id, brandId));
  await invalidateBrands();
}

/** Rust `reconcile_brand_ratings`: fixes every drifted brand; returns how many changed. */
export async function reconcileBrandRatings(): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({
      brandId: reviews.brandId,
      n: count(),
      sum: sql<number>`SUM(${reviews.rating})`,
    })
    .from(reviews)
    .where(eq(reviews.status, "approved"))
    .groupBy(reviews.brandId);
  const stored = new Map(
    (await db.select({ id: brands.id, rating: brands.rating }).from(brands)).map((b) => [
      b.id,
      b.rating,
    ]),
  );
  let corrected = 0;
  for (const row of rows) {
    if (!row.brandId || !stored.has(row.brandId)) continue;
    const avg = Number(row.sum) / row.n;
    const current = stored.get(row.brandId);
    if (current !== null && current !== undefined && Math.abs(current - avg) < 1e-9) continue;
    await db.update(brands).set({ rating: avg }).where(eq(brands.id, row.brandId));
    corrected += 1;
  }
  if (corrected > 0) await invalidateBrands();
  return corrected;
}

// ── Create / update / delete ────────────────────────────────────

export interface CreateReviewInput {
  bookingId?: string | null;
  tripSessionId?: string | null;
  routeId?: string | null;
  brandId?: string | null;
  rating: number;
  title?: string | null;
  content?: string | null;
  tags?: string[] | null;
  photos?: string[] | null;
  authorName?: string | null;
  authorPhone?: string | null;
}

export interface UpdateReviewInput {
  rating?: number | null;
  title?: string | null;
  content?: string | null;
  tags?: string[] | null;
  photos?: string[] | null;
}

const isOptString = (v: unknown, max: number): boolean =>
  v === undefined || v === null || (typeof v === "string" && [...v].length <= max);
const isOptStringList = (v: unknown, max?: number): boolean =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) &&
    v.every((s) => typeof s === "string") &&
    (max === undefined || v.length <= max));

/** The shared field rules of `CreateReviewInput` / `UpdateReviewInput` (the `validator` derives). */
function validateReviewFields(b: UpdateReviewInput, photosMax?: number): void {
  if (b.rating != null && (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5))
    throw badRequest("rating must be 1-5");
  if (!isOptString(b.title, 255)) throw badRequest("title has an invalid length");
  if (!isOptString(b.content, 10000)) throw badRequest("content has an invalid length");
  if (!isOptStringList(b.tags, 20)) throw badRequest("tags has an invalid length");
  if (!isOptStringList(b.photos, photosMax)) throw badRequest("photos has an invalid length");
}

export function validateCreateReview(b: CreateReviewInput): void {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  if (typeof b.rating !== "number" || !Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5)
    throw badRequest("rating must be 1-5");
  validateReviewFields(b, 10);
  if (!isOptString(b.authorName, 255)) throw badRequest("author name has an invalid length");
  const phone = b.authorPhone;
  if (phone != null) {
    if (typeof phone !== "string" || phone.length > 20)
      throw badRequest("author phone has an invalid length");
    if (!validPhone(phone)) throw badRequest("author phone must be a valid phone number");
  }
  for (const [name, id] of [
    ["bookingId", b.bookingId],
    ["tripSessionId", b.tripSessionId],
    ["routeId", b.routeId],
    ["brandId", b.brandId],
  ] as const) {
    if (id != null) uuidParam(name, typeof id === "string" ? id : "");
  }
}

export function validateUpdateReview(b: UpdateReviewInput): void {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  validateReviewFields(b);
}

function assertContentFits(content: string | null | undefined): void {
  if (content != null && [...content].length > MAX_CONTENT_CHARS)
    throw badRequest("content must be at most 5000 characters");
}

/** Rust `review_service::create` — the verified-ride rule for booking-scoped reviews. */
export async function createReview(userId: string, input: CreateReviewInput): Promise<string> {
  assertContentFits(input.content);
  const db = await getDb();

  let { brandId, routeId, tripSessionId, authorName, authorPhone } = {
    brandId: input.brandId ?? null,
    routeId: input.routeId ?? null,
    tripSessionId: input.tripSessionId ?? null,
    authorName: input.authorName ?? null,
    authorPhone: input.authorPhone ?? null,
  };

  if (input.bookingId) {
    const booking = (
      await db.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1)
    )[0];
    if (!booking) throw notFound("booking not found — you can only review trips you booked");
    if (booking.userId !== userId) throw forbidden("you can only review your own bookings");

    const trip = (
      await db
        .select()
        .from(tripSessions)
        .where(eq(tripSessions.id, booking.tripSessionId))
        .limit(1)
    )[0];
    if (!trip) throw notFound("the trip for this booking no longer exists");

    const schedule = (
      await db.select().from(schedules).where(eq(schedules.id, trip.scheduleId)).limit(1)
    )[0];
    // Improvement on Rust (which compares the date with today's UTC date and so
    // opens a morning bus 7 h late): the trip counts once its Vietnam departure
    // instant has passed.
    const leaves = schedule
      ? departureInstant(trip.departureDate, schedule.departureTime, trip.actualDepartureAt)
      : null;
    const departed = leaves
      ? leaves.getTime() <= Date.now()
      : (trip.departureDate.split("T")[0] ?? "") < localToday();
    if (booking.status === "cancelled" || trip.status === "cancelled")
      throw badRequest("cancelled trips cannot be reviewed");
    if (!departed)
      throw badRequest("you can only review trips you have ridden — this trip hasn't departed yet");

    const already = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.bookingId, input.bookingId)))
      .limit(1);
    if (already.length > 0) throw conflict("you have already reviewed this booking");

    // The review rides the booking's chain: trip → schedule → route → brand.
    if (schedule) {
      routeId = schedule.routeId;
      const route = (
        await db.select().from(routes).where(eq(routes.id, schedule.routeId)).limit(1)
      )[0];
      brandId = route?.brandId ?? brandId;
    }
    tripSessionId = trip.id;
    // Guest bookings carry contact info: surface it so staff can identify the reviewer.
    authorName ??= booking.contactName;
    authorPhone ??= booking.contactPhone;
  }

  const id = crypto.randomUUID();
  await db.insert(reviews).values({
    id,
    bookingId: input.bookingId ?? null,
    tripSessionId,
    routeId,
    brandId,
    userId,
    authorName,
    authorPhone,
    rating: input.rating,
    title: input.title ?? null,
    content: input.content ?? null,
    tags: input.tags?.length ? input.tags.join(",") : null,
    photos: input.photos?.length ? JSON.stringify(input.photos) : null,
    status: "pending",
  });
  await invalidateReviews();
  // Rust recomputes for the brand the caller sent, not the derived one.
  if (input.brandId) await recomputeBrandRating(input.brandId);
  return id;
}

/** Rust `review_service::update` — only the author, only the fields sent. */
export async function updateReview(
  id: string,
  userId: string,
  input: UpdateReviewInput,
): Promise<void> {
  const existing = await findReview(id);
  if (!existing) throw notFound("review not found");
  if (existing.userId !== userId) throw forbidden("can only update your own reviews");
  assertContentFits(input.content);

  const db = await getDb();
  const edited = [input.rating, input.title, input.content, input.tags, input.photos].some(
    (v) => v != null,
  );
  await db
    .update(reviews)
    .set({
      // Improvement on Rust: rewriting an approved review sends it back to moderation.
      ...(edited && existing.status === "approved" && { status: "pending" }),
      ...(input.rating != null && { rating: input.rating }),
      ...(input.title != null && { title: input.title }),
      ...(input.content != null && { content: input.content }),
      ...(input.tags != null && { tags: input.tags.join(",") }),
      ...(input.photos != null && { photos: JSON.stringify(input.photos) }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reviews.id, id));
  await invalidateReviews();
  if (existing.brandId) await recomputeBrandRating(existing.brandId);
}

/** Rust `review_service::remove`: the author, or staff when `userId` is null. */
export async function removeReview(id: string, userId: string | null): Promise<void> {
  const existing = await findReview(id);
  if (!existing) throw notFound("review not found");
  if (userId !== null && existing.userId !== userId)
    throw forbidden("can only delete your own reviews");
  const db = await getDb();
  await db.delete(reviews).where(eq(reviews.id, id));
  await invalidateReviews();
  if (existing.brandId) await recomputeBrandRating(existing.brandId);
}

// ── Moderation ──────────────────────────────────────────────────

/**
 * Rust `AdminService::update_review_status`. A reply is set when
 * `brandReply` is a string (an empty one included); `null` or absent leaves
 * it alone (serde reads `Option<Option<String>>` null as absent).
 */
export async function moderateReview(
  id: string,
  body: { status?: string | null; brandReply?: string | null },
): Promise<{ id: string; status: string }> {
  if (body.status != null && (typeof body.status !== "string" || body.status.length > 30))
    throw badRequest("status has an invalid length");
  if (body.brandReply != null && typeof body.brandReply !== "string")
    throw badRequest("invalid request body");
  const status = body.status?.trim() || undefined;
  if (status && !(REVIEW_STATUSES as readonly string[]).includes(status))
    throw badRequest(`invalid status: ${status}`);

  const existing = await findReview(id);
  if (!existing) throw notFound("review not found");

  const now = new Date().toISOString();
  const db = await getDb();
  await db
    .update(reviews)
    .set({
      ...(status && { status }),
      ...(body.brandReply != null && { reply: body.brandReply, repliedAt: now }),
      updatedAt: now,
    })
    .where(eq(reviews.id, id));
  await invalidateReviews();
  // A status change moves the approved set the brand rating is the mean of;
  // a reply alone does not.
  if (status && existing.brandId) await recomputeBrandRating(existing.brandId);
  return { id, status: status ?? existing.status };
}

export interface BrandReviewSummary {
  brandId?: string;
  brandName?: string;
  brandSlug?: string;
  brandLogo?: string;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  hidden: number;
  avgRating?: number;
}

/** `GET /api/admin/reviews/summary`: per-brand status counts, busiest first, unattributed last. */
export async function brandReviewSummary(): Promise<{ items: BrandReviewSummary[] }> {
  const db = await getDb();
  const grouped = await db
    .select({
      brandId: reviews.brandId,
      status: reviews.status,
      n: count(),
      sum: sql<number>`SUM(${reviews.rating})`,
    })
    .from(reviews)
    .groupBy(reviews.brandId, reviews.status);

  const byBrand = new Map<string | null, { counts: BrandReviewSummary; sum: number }>();
  for (const row of grouped) {
    const acc = byBrand.get(row.brandId) ?? {
      counts: { total: 0, pending: 0, approved: 0, rejected: 0, hidden: 0 },
      sum: 0,
    };
    acc.counts.total += row.n;
    if ((REVIEW_STATUSES as readonly string[]).includes(row.status))
      acc.counts[row.status as (typeof REVIEW_STATUSES)[number]] += row.n;
    acc.sum += Number(row.sum);
    byBrand.set(row.brandId, acc);
  }

  const ids = [...byBrand.keys()].filter((b): b is string => b !== null);
  const brandRows = ids.length
    ? await db
        .select({ id: brands.id, name: brands.name, slug: brands.slug, logoUrl: brands.logoUrl })
        .from(brands)
        .where(inArray(brands.id, ids))
        .orderBy(asc(brands.id))
    : [];
  const meta = new Map(brandRows.map((b) => [b.id, b]));

  const items = [...byBrand].map(([brandId, { counts, sum }]) => {
    const brand = brandId ? meta.get(brandId) : undefined;
    return {
      ...(brandId && { brandId }),
      ...(brand && { brandName: brand.name, brandSlug: brand.slug }),
      ...(brand?.logoUrl && { brandLogo: brand.logoUrl }),
      ...counts,
      // The average spans every status, rounded to one decimal.
      ...(counts.total > 0 && { avgRating: Math.round((sum / counts.total) * 10) / 10 }),
    };
  });
  items.sort(
    (a, b) =>
      b.total - a.total || Number(a.brandId === undefined) - Number(b.brandId === undefined),
  );
  return { items };
}
