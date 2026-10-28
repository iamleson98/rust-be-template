import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { adConversions, bookings, posts, priceAlerts, tripSessions } from "@/lib/db/schema";
import { setCloudflareContext } from "../helpers/context";
import { reportConversion } from "@/lib/services/ads";
import { loyaltySummary } from "@/lib/services/loyalty";
import {
  createPost,
  deletePost,
  getPost,
  listPosts,
  updatePost,
  validatePost,
} from "@/lib/services/posts";
import { cancelPriceAlert, createPriceAlert, listPriceAlerts } from "@/lib/services/price-alerts";
import { fixture, hold, migrate, owner, rejection, type Fixture } from "../helpers/fixture";

/** Price alerts, loyalty, posts and the ads beacon: the small services of the engagement domain. */

beforeAll(migrate);

const alertBody = {
  phone: "0912345678",
  fromName: "Hà Nội",
  toName: "Đà Nẵng",
  targetPrice: 250_000,
};

describe("price alerts", () => {
  beforeEach(async () => {
    await (await getDb()).delete(priceAlerts);
  });

  it("creates an active alert that expires in 30 days, and flags the repeat as a duplicate", async () => {
    const u = await owner();
    const first = await createPriceAlert(u, alertBody, 250_000);
    expect(first.duplicate).toBe(false);
    expect(first.alert).toMatchObject({
      status: "active",
      frequency: "daily",
      routeId: null,
      lastTriggeredAt: null,
    });
    const days =
      (Date.parse(first.alert.expiresAt!) - Date.parse(first.alert.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(30, 3);

    const again = await createPriceAlert(u, { ...alertBody, fromName: "other" }, 250_000);
    expect(again).toMatchObject({ duplicate: true, alert: { id: first.alert.id } });
    expect((await createPriceAlert(u, alertBody, 200_000)).duplicate).toBe(false); // another target
  });

  it("trims, defaults the frequency and enforces the service rules", async () => {
    const u = await owner();
    const { alert } = await createPriceAlert(
      u,
      { ...alertBody, phone: " 0912345678 ", fromName: " A ", frequency: " " },
      1,
    );
    expect(alert).toMatchObject({ phone: "0912345678", fromName: "A", frequency: "daily" });
    expect(await rejection(createPriceAlert(u, { ...alertBody, phone: "0241234567" }, 1))).toEqual({
      status: 400,
      message: "invalid Vietnamese phone number",
    });
    expect((await rejection(createPriceAlert(u, { ...alertBody, fromName: "  " }, 1))).status).toBe(
      400,
    );
    expect(await rejection(createPriceAlert(u, alertBody, 0))).toEqual({
      status: 400,
      message: "target_price must be positive",
    });
  });

  it("lists the owner's alerts with a total, or a guest's by phone", async () => {
    const [a, b] = [await owner(), await owner()];
    await createPriceAlert(a, alertBody, 100_000);
    await createPriceAlert(a, alertBody, 200_000);
    await createPriceAlert(b, { ...alertBody, phone: "0987654321" }, 100_000);
    const page = await listPriceAlerts({
      userId: a,
      phone: null,
      status: null,
      limit: 1,
      offset: 0,
    });
    expect(page).toMatchObject({ total: 2, limit: 1, offset: 0 });
    const guest = await listPriceAlerts({
      userId: null,
      phone: " 0987654321 ",
      status: "active",
      limit: 20,
      offset: 0,
    });
    expect(guest.items).toHaveLength(1);
    expect(
      (
        await rejection(
          listPriceAlerts({ userId: null, phone: null, status: null, limit: 20, offset: 0 }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await rejection(
          listPriceAlerts({ userId: null, phone: " ", status: null, limit: 20, offset: 0 }),
        )
      ).status,
    ).toBe(400);
  });

  it("cancel is a soft delete that only the owner may do; a phone-only alert has no owner", async () => {
    const [a, b] = [await owner(), await owner()];
    const { alert } = await createPriceAlert(a, alertBody, 100_000);
    expect((await rejection(cancelPriceAlert(alert.id, b))).status).toBe(403);
    expect(await cancelPriceAlert(alert.id, a)).toMatchObject({
      id: alert.id,
      status: "cancelled",
    });
    const orphan = crypto.randomUUID();
    await (await getDb()).insert(priceAlerts).values({ id: orphan, phone: "0912345678" });
    expect((await cancelPriceAlert(orphan, b)).status).toBe("cancelled");
    expect((await rejection(cancelPriceAlert(crypto.randomUUID(), a))).status).toBe(404);
  });
});

describe("loyalty", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture(3);
  });

  it("earns from completed bookings only and reports the next tier and history", async () => {
    const u = await owner();
    expect(await loyaltySummary(u)).toMatchObject({
      points: 0,
      completedTrips: 0,
      totalSpent: 0,
      currency: "VND",
      tier: { key: "bronze" },
      nextTier: { key: "silver" },
      history: [],
    });

    const done = await hold(f, u, 2); // 2 × 350,000
    await hold(f, u, 1).catch(() => null); // seat already held: no second booking
    const db = await getDb();
    await db.update(bookings).set({ status: "completed" }).where(eq(bookings.id, done.bookingId));
    const summary = await loyaltySummary(u);
    expect(summary).toMatchObject({ points: 70, completedTrips: 1, totalSpent: 700_000 });
    expect(summary.history[0]).toMatchObject({
      bookingId: done.bookingId,
      routeName: "Hà Nội - Đà Nẵng",
      brandName: "Seed Brand",
      total: 700_000,
      points: 70,
    });
    expect(summary.history[0]!.departureAt).toMatch(/^\d{4}-\d{2}-\d{2}T08:30$/);

    await db
      .update(tripSessions)
      .set({ actualDepartureAt: "2026-10-01T01:00:00Z" })
      .where(eq(tripSessions.id, f.trip));
    expect((await loyaltySummary(u)).history[0]!.departureAt).toBe("2026-10-01T01:00:00Z");
  });
});

describe("posts", () => {
  beforeEach(async () => {
    await (await getDb()).delete(posts);
  });

  it("validates like Rust: title 1-256, a body, either optional on a patch", () => {
    expect(() => validatePost({ title: "", body: "b" }, false)).toThrow();
    expect(() => validatePost({ title: "t".repeat(257), body: "b" }, false)).toThrow();
    expect(() => validatePost({ title: "t" }, false)).toThrow();
    expect(() => validatePost({ title: "ế".repeat(129), body: "b" }, false)).toThrow(/1-256/); // 258 bytes
    expect(() => validatePost({}, true)).not.toThrow();
    expect(() => validatePost({ body: "" }, true)).toThrow();
  });

  it("keeps the text as sent, lists newest first and patches only what is sent", async () => {
    const author = await owner();
    const a = await createPost(author, { title: "  Một  ", body: "x" });
    expect(a.title).toBe("  Một  "); // no trimming
    await new Promise((r) => setTimeout(r, 2));
    const b = await createPost(author, { title: "Hai", body: "y" });
    expect((await listPosts(20, 0)).items.map((p) => p.id)).toEqual([b.id, a.id]);
    expect(await listPosts(500, 0)).toMatchObject({ limit: 200, offset: 0 });
    expect((await updatePost(a.id, { body: "mới" })).title).toBe("  Một  ");
    expect((await rejection(getPost(crypto.randomUUID()))).status).toBe(404);
    await deletePost(a.id);
    await deletePost(a.id); // deleting twice is fine
    expect((await listPosts(20, 0)).items).toHaveLength(1);
  });
});

describe("ads conversions", () => {
  beforeEach(async () => {
    setCloudflareContext();
    await (await getDb()).delete(adConversions);
  });

  it("stores a normalised record, dedupes on (event, transactionId) and marks it unconfigured", async () => {
    const first = await reportConversion({
      event: " Purchase ",
      transactionId: "t-1",
      value: " 350000 ",
      currency: "vnd",
      clickIds: { gclid: " abc " },
    });
    expect(first).toEqual({
      ok: true,
      stored: true,
      uploadAttempted: false,
      serverUploadEnabled: false,
    });
    expect(await reportConversion({ event: "purchase", transactionId: "t-1" })).toMatchObject({
      stored: false,
    });

    const rows = await (await getDb()).select().from(adConversions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event: "purchase",
      conversionValue: "350000",
      currency: "VND",
      gclid: "abc",
      status: "unconfigured",
    });
  });

  it("mints an id for an id-less beacon, so each fire records distinctly", async () => {
    await reportConversion({ event: "booking" });
    await reportConversion({ event: "booking" });
    expect(await (await getDb()).select().from(adConversions)).toHaveLength(2);
  });

  it("rejects an empty or over-long event and transaction id; drops absurd values and click ids", async () => {
    expect((await rejection(reportConversion({ event: "  " }))).status).toBe(400);
    expect((await rejection(reportConversion({ event: "e".repeat(33) }))).status).toBe(400);
    expect(
      (await rejection(reportConversion({ event: "x", transactionId: "t".repeat(129) }))).status,
    ).toBe(400);
    await reportConversion({
      event: "x",
      transactionId: "t",
      value: "9".repeat(33),
      clickIds: { gclid: "g".repeat(1025) },
    });
    expect((await (await getDb()).select().from(adConversions))[0]).toMatchObject({
      conversionValue: null,
      gclid: null,
    });
  });
});
