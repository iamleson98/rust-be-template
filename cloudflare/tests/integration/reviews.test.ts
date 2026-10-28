import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { brands, reviews } from "@/lib/db/schema";
import {
  approvedReviewTags,
  brandReviewSummary,
  createReview,
  getPublicReview,
  listAdminReviews,
  listMyReviews,
  listPublicReviews,
  moderateReview,
  reconcileBrandRatings,
  recomputeBrandRating,
  removeReview,
  reviewStats,
  updateReview,
  validateCreateReview,
} from "@/lib/services/reviews";
import { fixture, hold, migrate, owner, rejection, type Fixture } from "../helpers/fixture";
import { departIn } from "../helpers/fixture";

/**
 * Port of `review_service.rs`'s tests (an imported rating survives until
 * approved reviews exist; approved reviews take over) plus the behaviour
 * the Rust service has but never tests: the verified-ride rule, ownership,
 * the public/approved-only surface and moderation.
 */

beforeAll(migrate);

let f: Fixture;
beforeEach(async () => {
  f = await fixture(3);
  await (await getDb()).delete(reviews);
});

async function insert(over: Partial<typeof reviews.$inferInsert> = {}) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(reviews).values({
    id,
    brandId: f.brandId,
    rating: 5,
    status: "approved",
    authorName: "Khách hàng",
    authorPhone: "0912345678",
    ...over,
  });
  return id;
}

const brandRating = async () =>
  (await (await getDb()).select().from(brands).where(eq(brands.id, f.brandId)))[0]!.rating;

describe("brand rating", () => {
  it("an imported rating survives until approved reviews exist", async () => {
    const db = await getDb();
    await db.update(brands).set({ rating: 4.6 }).where(eq(brands.id, f.brandId));
    expect(await reconcileBrandRatings()).toBe(0);
    expect(await reconcileBrandRatings()).toBe(0);
    expect(await brandRating()).toBe(4.6);
    await recomputeBrandRating(f.brandId);
    expect(await brandRating()).toBe(4.6);
  });

  it("approved reviews take over the rating", async () => {
    const db = await getDb();
    await db.update(brands).set({ rating: 4.6 }).where(eq(brands.id, f.brandId));
    await insert({ rating: 5 });
    await insert({ rating: 4 });
    await insert({ rating: 1, status: "pending" });
    expect(await reconcileBrandRatings()).toBe(1);
    expect(await brandRating()).toBe(4.5);
    expect(await reconcileBrandRatings()).toBe(0);
  });

  it("moderating a status recomputes it; a reply alone does not", async () => {
    const id = await insert({ rating: 2, status: "pending" });
    await moderateReview(id, { brandReply: "Cảm ơn bạn" });
    expect(await brandRating()).toBeNull();
    await moderateReview(id, { status: "approved" });
    expect(await brandRating()).toBe(2);
    await moderateReview(id, { status: "hidden" });
    expect(await brandRating()).toBe(2); // no approved review left: the last value stays
  });
});

describe("creating a review", () => {
  const body = { rating: 5, content: "Xe sạch, đúng giờ" };

  it("validates rating, lengths, tags, photos and phone", () => {
    for (const bad of [
      { rating: 0 },
      { rating: 6 },
      { rating: 4.5 },
      { rating: 5, title: "x".repeat(256) },
      { rating: 5, content: "x".repeat(10_001) },
      { rating: 5, tags: Array(21).fill("a") },
      { rating: 5, photos: Array(11).fill("p") },
      { rating: 5, authorPhone: "abc" },
      { rating: 5, brandId: "not-a-uuid" },
    ])
      expect(() => validateCreateReview(bad as never), JSON.stringify(bad)).toThrow();
    expect(() => validateCreateReview(body)).not.toThrow();
  });

  it("caps content at 5000 bytes, not characters", async () => {
    const u = await owner();
    const err = await rejection(createReview(u, { rating: 5, content: "ế".repeat(1700) }));
    expect(err).toEqual({ status: 400, message: "content must be at most 5000 characters" });
  });

  it("stores a pending review with tags comma-joined, as Rust does", async () => {
    const u = await owner();
    const id = await createReview(u, { ...body, tags: ["sạch", "đúng giờ"], brandId: f.brandId });
    const row = (await (await getDb()).select().from(reviews).where(eq(reviews.id, id)))[0]!;
    expect(row).toMatchObject({
      status: "pending",
      userId: u,
      tags: "sạch,đúng giờ",
      helpfulCount: 0,
    });
    expect(row.authorName).toBeNull(); // no booking, no name given: nothing is guessed
  });

  describe("verified ride (booking-scoped)", () => {
    async function ridden() {
      const u = await owner();
      const held = await hold(f, u, 1);
      await departIn(f, -48);
      return { u, bookingId: held.bookingId };
    }

    it("404s an unknown booking and 403s someone else's", async () => {
      const u = await owner();
      expect(
        (await rejection(createReview(u, { ...body, bookingId: crypto.randomUUID() }))).status,
      ).toBe(404);
      const { bookingId } = await ridden();
      expect(await rejection(createReview(u, { ...body, bookingId }))).toEqual({
        status: 403,
        message: "you can only review your own bookings",
      });
    });

    it("refuses a trip that has not departed (400)", async () => {
      const u = await owner();
      const { bookingId } = await hold(f, u, 1);
      expect(await rejection(createReview(u, { ...body, bookingId }))).toEqual({
        status: 400,
        message: "you can only review trips you have ridden — this trip hasn't departed yet",
      });
    });

    it("refuses a cancelled trip", async () => {
      const { u, bookingId } = await ridden();
      const db = await getDb();
      const { tripSessions } = await import("@/lib/db/schema");
      await db.update(tripSessions).set({ status: "cancelled" }).where(eq(tripSessions.id, f.trip));
      expect(await rejection(createReview(u, { ...body, bookingId }))).toEqual({
        status: 400,
        message: "cancelled trips cannot be reviewed",
      });
    });

    it("denormalises route, brand and trip and borrows the contact as author, once per booking", async () => {
      const { u, bookingId } = await ridden();
      const id = await createReview(u, { ...body, bookingId });
      const row = (await (await getDb()).select().from(reviews).where(eq(reviews.id, id)))[0]!;
      expect(row).toMatchObject({
        bookingId,
        brandId: f.brandId,
        routeId: f.routeId,
        tripSessionId: f.trip,
        authorName: "Nguyễn Văn A",
        authorPhone: "0912345678",
      });
      expect(await rejection(createReview(u, { ...body, bookingId }))).toEqual({
        status: 409,
        message: "you have already reviewed this booking",
      });
    });
  });
});

describe("the public surface", () => {
  it("lists approved reviews only, newest first, without the author's phone", async () => {
    await insert({ createdAt: "2026-01-01T00:00:00.000Z", title: "old" });
    await insert({ createdAt: "2026-02-01T00:00:00.000Z", title: "new" });
    await insert({ status: "pending", title: "pending" });
    await insert({ status: "rejected", title: "rejected" });
    const { items } = await listPublicReviews({
      brandId: f.brandId,
      routeId: null,
      limit: 20,
      offset: 0,
    });
    expect(items.map((r) => r.title)).toEqual(["new", "old"]);
    expect(items[0]).not.toHaveProperty("authorPhone");
    expect(items[0]).toMatchObject({ authorName: "Khách hàng", status: "approved" });
    expect(items[0]).not.toHaveProperty("tags"); // empty arrays are omitted, as serde does
  });

  it("caps the page at 200 and honours offset and limit 0", async () => {
    await insert();
    await insert();
    expect(
      (await listPublicReviews({ brandId: null, routeId: null, limit: 1, offset: 1 })).items,
    ).toHaveLength(1);
    expect(
      (await listPublicReviews({ brandId: null, routeId: null, limit: 0, offset: 0 })).items,
    ).toHaveLength(0);
  });

  it("serves one review only while approved", async () => {
    const approved = await insert();
    const pending = await insert({ status: "pending" });
    expect(await getPublicReview(approved)).not.toHaveProperty("authorPhone");
    expect((await rejection(getPublicReview(pending))).status).toBe(404);
  });

  it("indexes the tags of approved reviews, sorted, from either storage format", async () => {
    await insert({ tags: "sạch,đúng giờ" });
    await insert({ tags: JSON.stringify(["thân thiện"]) }); // written by the port before
    await insert({ tags: "bí mật", status: "pending" });
    expect(await approvedReviewTags()).toEqual(["thân thiện", "sạch", "đúng giờ"].sort());
  });

  it("stats count stars and the five top tags over approved reviews", async () => {
    await insert({ rating: 5, tags: "sạch,đúng giờ" });
    await insert({ rating: 5, tags: "sạch" });
    await insert({ rating: 4 });
    await insert({ rating: 1, status: "pending" });
    const stats = await reviewStats(f.brandId, null);
    expect(stats).toEqual({
      count: 3,
      average: 14 / 3,
      byRating: [0, 0, 0, 1, 2],
      topTags: [
        { tag: "sạch", count: 2 },
        { tag: "đúng giờ", count: 1 },
      ],
    });
    expect((await rejection(reviewStats(null, null))).status).toBe(400);
  });
});

describe("the author's own reviews", () => {
  it("lists with a true total and the forced owner", async () => {
    const mine = await owner();
    const other = await owner();
    await insert({ userId: mine, status: "pending" });
    await insert({ userId: mine });
    await insert({ userId: other });
    const page = await listMyReviews(mine, null, 1, 0);
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toHaveProperty("authorPhone"); // the author sees their own phone
    expect((await listMyReviews(mine, "approved", 20, 0)).total).toBe(1);
  });

  it("update touches only what is sent and leaves the status alone; only the author may", async () => {
    const mine = await owner();
    const id = await insert({ userId: mine, title: "old", content: "keep", tags: "a" });
    expect((await rejection(updateReview(id, await owner(), { rating: 3 }))).status).toBe(403);
    await updateReview(id, mine, { rating: 3, tags: ["x", "y"] });
    const row = (await (await getDb()).select().from(reviews).where(eq(reviews.id, id)))[0]!;
    expect(row).toMatchObject({
      rating: 3,
      title: "old",
      content: "keep",
      tags: "x,y",
      status: "approved",
    });
    expect((await rejection(updateReview(crypto.randomUUID(), mine, {}))).status).toBe(404);
  });

  it("delete: the author, or staff with no owner check", async () => {
    const mine = await owner();
    const id = await insert({ userId: mine });
    expect((await rejection(removeReview(id, await owner()))).status).toBe(403);
    await removeReview(id, mine);
    const again = await insert({ userId: mine });
    await removeReview(again, null);
    expect(await (await getDb()).select().from(reviews)).toHaveLength(0);
    expect((await rejection(removeReview(again, null))).status).toBe(404);
  });
});

describe("moderation", () => {
  it("rejects an unknown status, sets a reply with its time, and leaves it when only the status changes", async () => {
    const id = await insert({ status: "pending" });
    expect(await rejection(moderateReview(id, { status: "published" }))).toEqual({
      status: 400,
      message: "invalid status: published",
    });
    expect(await moderateReview(id, { status: "approved", brandReply: "Cảm ơn" })).toEqual({
      id,
      status: "approved",
    });
    const replied = (await (await getDb()).select().from(reviews).where(eq(reviews.id, id)))[0]!;
    expect(replied.reply).toBe("Cảm ơn");
    expect(replied.repliedAt).not.toBeNull();

    await moderateReview(id, { status: "hidden", brandReply: null });
    const after = (await (await getDb()).select().from(reviews).where(eq(reviews.id, id)))[0]!;
    expect(after).toMatchObject({ status: "hidden", reply: "Cảm ơn" });
    expect(await moderateReview(id, {})).toEqual({ id, status: "hidden" });
    expect((await rejection(moderateReview(crypto.randomUUID(), {}))).status).toBe(404);
  });

  it("the admin list pages with a total and searches name, phone, title and content", async () => {
    await insert({ title: "Tuyệt vời", status: "pending" });
    await insert({ content: "xe sạch", authorName: "An" });
    await insert({ authorPhone: "0999888777" });
    expect((await listAdminReviews({ status: "pending" }, 50, 0)).total).toBe(1);
    expect((await listAdminReviews({ search: "0999" }, 50, 0)).items).toHaveLength(1);
    expect((await listAdminReviews({ search: "sạch" }, 50, 0)).items).toHaveLength(1);
    expect(await listAdminReviews({}, 2, 1)).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect((await listAdminReviews({}, 0, 0)).limit).toBe(1);
  });

  it("the brand summary counts statuses, averages every status to one decimal, busiest first", async () => {
    const db = await getDb();
    const other = crypto.randomUUID();
    await db.insert(brands).values({ id: other, slug: "other", name: "Other" });
    await insert({ rating: 5 });
    await insert({ rating: 4, status: "pending" });
    await insert({ rating: 2, status: "rejected" });
    await insert({ brandId: other, rating: 3, status: "hidden" });
    await insert({ brandId: null, rating: 5 });
    const { items } = await brandReviewSummary();
    expect(items[0]).toMatchObject({
      brandId: f.brandId,
      brandName: "Seed Brand",
      total: 3,
      pending: 1,
      approved: 1,
      rejected: 1,
      hidden: 0,
      avgRating: 3.7,
    });
    expect(items.at(-1)).not.toHaveProperty("brandId"); // unattributed rows last
    expect(items.at(-1)).toMatchObject({ total: 1, avgRating: 5 });
  });
});
