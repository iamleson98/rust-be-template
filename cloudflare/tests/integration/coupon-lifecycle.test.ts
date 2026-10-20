import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration4 from "../../migrations/0004_deep_callisto.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { createBooking, completeBookingPayment, cancelBooking } from "@/lib/services/booking";
import { triggerJob } from "@/lib/services/jobs";
import {
  brands,
  bookings,
  busLayouts,
  coupons,
  discountCampaigns,
  discountTiers,
  routes,
  schedules,
  seats,
  tripSessions,
  users,
} from "@/lib/db/schema";

/**
 * Coupon lifecycle over a real D1 — the full Rust parity chain:
 *
 *   claim → held (active_holder set)
 *         → booking: reserved (on the booking, holder kept)
 *         → payment/admin confirm: redeemed (holder released)
 *         → cancel/sweep: back to held while valid, else expired
 *   give-up → released; nightly coupons.expire → expired + holder cleared
 *
 * Plus the unique-index race guards from migration 0004.
 */

const USER_ID = "22222222-2222-4222-8222-222222222222";
let CAMPAIGN_A = ""; // running window
let CAMPAIGN_B = "";
let CAMPAIGN_C = "";
let TIER_A = "";
let TIER_B = "";
let TIER_C = "";
let TRIP_ID = "";
let SEAT_1 = "";
let SEAT_2 = "";
const ENDS_AT = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 2 * 86_400_000).toISOString();

function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 86_400_000).toISOString();
}

async function authReq(url: string, init: RequestInit = {}): Promise<Request> {
  const token = await signAccessToken(USER_ID);
  return new Request(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration4);
  const db = await getDb();

  // User (customer) + brand + route + schedule + layout + seats + trip.
  await db.insert(users).values({
    id: USER_ID,
    fullName: "Coupon Tester",
    email: "coupon@test.vn",
    role: "user",
    status: "active",
    locale: "vi",
  });
  const brandId = crypto.randomUUID();
  await db.insert(brands).values({ id: brandId, slug: "coupon-bus", name: "Coupon Bus" });
  const routeId = crypto.randomUUID();
  await db.insert(routes).values({
    id: routeId,
    brandId,
    name: "HN → SGN",
    startLocationId: "ha-noi",
    endLocationId: "ho-chi-minh",
  });
  const layoutId = crypto.randomUUID();
  await db.insert(busLayouts).values({ id: layoutId, name: "2-seat layout", totalSeats: 2 });
  SEAT_1 = crypto.randomUUID();
  SEAT_2 = crypto.randomUUID();
  await db.insert(seats).values([
    { id: SEAT_1, busLayoutId: layoutId, seatLabel: "01", rowNum: 1, colNum: 1, floor: 1 },
    { id: SEAT_2, busLayoutId: layoutId, seatLabel: "02", rowNum: 1, colNum: 2, floor: 1 },
  ]);
  const scheduleId = crypto.randomUUID();
  await db.insert(schedules).values({
    id: scheduleId,
    routeId,
    departureTime: "08:00",
    busLayoutId: layoutId,
    basePriceAdult: 100_000,
  });
  TRIP_ID = crypto.randomUUID();
  await db.insert(tripSessions).values({
    id: TRIP_ID,
    scheduleId,
    departureDate: daysFromNow(3).slice(0, 10),
    totalSeats: 2,
    availableSeats: 2,
  });

  // Named campaigns (claim tests) + a POOL of extra campaigns, one per
  // fixture coupon (the (campaign_id, user_id) UNIQUE index allows exactly
  // one coupon row per campaign per account — the system enforces it, so
  // fixtures must not seed two coupons of one campaign for the same user).
  const pool: Array<{ campaignId: string; tierId: string }> = [];
  const defs: Array<["A" | "B" | "C" | "pool", string]> = [
    ["A", "Tết campaign"],
    ["B", "Summer campaign"],
    ["C", "Autumn campaign"],
    ["pool", "Pool 1"],
    ["pool", "Pool 2"],
    ["pool", "Pool 3"],
    ["pool", "Pool 4"],
    ["pool", "Pool 5"],
    ["pool", "Pool 6"],
    ["pool", "Pool 7"],
  ];
  for (const [slot, name] of defs) {
    const id = crypto.randomUUID();
    const tier = crypto.randomUUID();
    await db.insert(discountCampaigns).values({
      id,
      name,
      startsAt: daysFromNow(-1),
      endsAt: ENDS_AT,
      couponValidity: "campaign",
      allBrands: true,
    });
    await db.insert(discountTiers).values({
      id: tier,
      campaignId: id,
      amount: 20_000,
      totalSlots: 10,
    });
    if (slot === "A") {
      CAMPAIGN_A = id;
      TIER_A = tier;
    } else if (slot === "B") {
      CAMPAIGN_B = id;
      TIER_B = tier;
    } else if (slot === "C") {
      CAMPAIGN_C = id;
      TIER_C = tier;
    } else {
      pool.push({ campaignId: id, tierId: tier });
    }
  }
  // Hand out a fresh campaign/tier pair per fixture coupon.
  (globalThis as { __couponPool?: typeof pool }).__couponPool = pool;
});

/** Next unused campaign/tier pair (fixtures never collide). */
function takeTier(): { campaignId: string; tierId: string } {
  const pool = (globalThis as { __couponPool?: Array<{ campaignId: string; tierId: string }> })
    .__couponPool!;
  const pair = pool.shift();
  if (!pair) throw new Error("fixture campaign pool exhausted");
  return pair;
}

async function couponRow(id: string) {
  const db = await getDb();
  return (await db.select().from(coupons).where(eq(coupons.id, id)).limit(1))[0];
}

/** The claim route, invoked exactly like the SPA does. */
async function claim(campaignId: string, tierId: string) {
  const { POST } = await import("../../src/app/api/campaigns/[id]/tiers/[tierId]/claim/route");
  const req = await authReq(
    `https://datxevui.com/api/campaigns/${campaignId}/tiers/${tierId}/claim`,
    { method: "POST" },
  );
  return POST(req, { params: Promise.resolve({ id: campaignId, tierId }) });
}

/** Directly place a coupon row in a given state (fixture shortcut).
 * Takes a FRESH campaign/tier pair so the (campaign, user) unique rule
 * holds; claim-test campaigns are claimed exactly once via the route. */
async function seedCoupon(over: {
  status: string;
  activeHolder?: string | null;
  validUntil?: string | null;
}): Promise<string> {
  const db = await getDb();
  const { campaignId, tierId } = takeTier();
  const id = crypto.randomUUID();
  await db.insert(coupons).values({
    id,
    code: `DXV-T${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    campaignId,
    tierId,
    userId: USER_ID,
    amount: 20_000,
    status: over.status,
    activeHolder: over.activeHolder ?? null,
    validUntil: over.validUntil ?? null,
    claimedAt: new Date().toISOString(),
  });
  return id;
}

describe("claim → held (one per account, one per campaign)", () => {
  it("claims a coupon of a running tier", async () => {
    const res = await claim(CAMPAIGN_A, TIER_A);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; validUntil: string };
    expect(body.status).toBe("held");
    expect(body.validUntil).toBe(ENDS_AT); // campaign-validity → window end
    const row = await couponRow(body.id);
    expect(row?.activeHolder).toBe(USER_ID);
  });

  it("rejects a second concurrent coupon (already-held)", async () => {
    const res = await claim(CAMPAIGN_B, TIER_B);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "coupon_already_held",
    );
  });

  it("rejects re-claiming the same campaign even after the coupon left the account", async () => {
    const db = await getDb();
    await db
      .update(coupons)
      .set({ status: "released", activeHolder: null })
      .where(eq(coupons.activeHolder, USER_ID));
    const res = await claim(CAMPAIGN_A, TIER_A);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "campaign_already_claimed",
    );
  });
});

describe("lazy expiry frees a locked account (Rust claim semantics)", () => {
  it("expires the caller's stale held coupon and lets them claim another campaign", async () => {
    const staleId = await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: PAST,
    });
    // Claim a different campaign: the stale B coupon must be lazily
    // expired first, or this would 409 already-held.
    const res = await claim(CAMPAIGN_C, TIER_C);
    expect(res.status).toBe(201);
    const row = await couponRow(staleId);
    expect(row?.status).toBe("expired");
    expect(row?.activeHolder).toBeNull();
  });
});

describe("wallet (GET /api/coupons/mine)", () => {
  it("lazily expires stale held coupons and reports the active one", async () => {
    const db = await getDb();
    // Release the C coupon so the wallet starts clean.
    await db
      .update(coupons)
      .set({ status: "released", activeHolder: null })
      .where(eq(coupons.activeHolder, USER_ID));
    const staleId = await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: daysFromNow(-1),
    });
    const { GET } = await import("../../src/app/api/coupons/mine/route");
    const res = await GET(await authReq("https://datxevui.com/api/coupons/mine"));
    const body = (await res.json()) as {
      active: { id: string } | null;
      claimedCampaignIds: string[];
    };
    expect(res.status).toBe(200);
    expect(body.active).toBeNull(); // the stale one expired on read
    const row = await couponRow(staleId);
    expect(row?.status).toBe("expired");
    expect(row?.activeHolder).toBeNull();
    expect(body.claimedCampaignIds).toContain(CAMPAIGN_A);
    expect(body.claimedCampaignIds).toContain(CAMPAIGN_C);
    expect(body.claimedCampaignIds.length).toBeGreaterThanOrEqual(3); // + pool fixtures
  });
});

describe("give up (DELETE /api/coupons/mine)", () => {
  it("releases the coupon and returns the tier slot while the campaign runs", async () => {
    const db = await getDb();
    const heldId = await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: daysFromNow(20),
    });
    const held = await couponRow(heldId);
    await db
      .update(discountTiers)
      .set({ claimedSlots: 3 })
      .where(eq(discountTiers.id, held!.tierId));
    const { DELETE } = await import("../../src/app/api/coupons/mine/route");
    const res = await DELETE(
      await authReq("https://datxevui.com/api/coupons/mine", { method: "DELETE" }),
    );
    expect(res.status).toBe(200);
    const row = await couponRow(heldId);
    expect(row?.status).toBe("released"); // Rust release status
    expect(row?.activeHolder).toBeNull();
    const tier = (
      await db.select().from(discountTiers).where(eq(discountTiers.id, held!.tierId)).limit(1)
    )[0];
    expect(tier?.claimedSlots).toBe(2); // slot returned (campaign still running)
  });
});

describe("booking lifecycle drives the coupon (reserve → redeem / return)", () => {
  it("reserves the coupon on the booking, redeems on payment, returns on cancel", async () => {
    const db = await getDb();
    const couponId = await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: daysFromNow(25),
    });

    // 1. Booking with the coupon → reserved on the booking, holder kept.
    const booking = await createBooking(USER_ID, {
      tripId: TRIP_ID,
      seatIds: [SEAT_1],
      passengers: [{ name: "Passenger One", type: "adult" }],
      contactName: "Coupon Tester",
      contactPhone: "0900123456",
      couponId,
    });
    let row = await couponRow(couponId);
    expect(row?.status).toBe("reserved");
    expect(row?.activeHolder).toBe(USER_ID);
    expect(row?.bookingId).toBe(booking.booking.id);
    const bookingRow = (
      await db.select().from(bookings).where(eq(bookings.id, booking.booking.id)).limit(1)
    )[0];
    expect(bookingRow?.campaignAppliedId).toBe(couponId);

    // 2. Payment completes → redeemed + holder released.
    await completeBookingPayment(booking.booking.id);
    row = await couponRow(couponId);
    expect(row?.status).toBe("redeemed");
    expect(row?.activeHolder).toBeNull();
    expect(row?.redeemedAt).toBeTruthy();

    // 3. A second booking with a second coupon → cancel returns it.
    const coupon2 = await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: daysFromNow(25),
    });
    const booking2 = await createBooking(USER_ID, {
      tripId: TRIP_ID,
      seatIds: [SEAT_2],
      passengers: [{ name: "Passenger Two", type: "adult" }],
      contactName: "Coupon Tester",
      contactPhone: "0900123456",
      couponId: coupon2,
    });
    row = await couponRow(coupon2);
    expect(row?.status).toBe("reserved");

    const cancelled = await cancelBooking(USER_ID, booking2.booking.id);
    expect(cancelled.status).toBe("cancelled");
    row = await couponRow(coupon2);
    expect(row?.status).toBe("held"); // window still open → back to the owner
    expect(row?.activeHolder).toBe(USER_ID);
    expect(row?.bookingId).toBeNull();

    // 4. An expired-window coupon cannot start a booking (validated up
    //    front — Rust `still_valid` at use time).
    await db
      .update(coupons)
      .set({ status: "expired", activeHolder: null })
      .where(eq(coupons.id, coupon2));
    const coupon4 = await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: daysFromNow(-1),
    });
    await expect(
      createBooking(USER_ID, {
        tripId: TRIP_ID,
        seatIds: [SEAT_1],
        passengers: [{ name: "Passenger Three", type: "adult" }],
        contactName: "Coupon Tester",
        contactPhone: "0900123456",
        couponId: coupon4,
      }),
    ).rejects.toThrow(/^coupon_expired$/);
  });
});

describe("nightly coupons.expire (cron job parity)", () => {
  it("expires stale held coupons and clears their holder", async () => {
    const db = await getDb();
    // Clear any held coupon left by the previous suite (unique holder).
    await db
      .update(coupons)
      .set({ status: "expired", activeHolder: null })
      .where(eq(coupons.activeHolder, USER_ID));
    await seedCoupon({
      status: "held",
      activeHolder: USER_ID,
      validUntil: daysFromNow(-1),
    });
    const outcome = await triggerJob("coupons.expire");
    expect(outcome.status).toBe("succeeded");
    const stale = (
      await db.select().from(coupons).where(eq(coupons.activeHolder, USER_ID)).limit(1)
    )[0];
    expect(stale).toBeUndefined(); // holder cleared
    const expired = await db.select().from(coupons).where(eq(coupons.status, "expired"));
    expect(expired.length).toBeGreaterThan(0);
  });
});

/** drizzle wraps D1 errors — the UNIQUE text lives on `cause`. */
async function expectUniqueViolation(fn: () => Promise<unknown>): Promise<void> {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  const e = err as Error & { cause?: { message?: string } };
  const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  expect(text).toMatch(/UNIQUE constraint failed/i);
}

describe("unique-index race guards (migration 0004)", () => {
  it("rejects two active holders of the same account", async () => {
    const db = await getDb();
    const other = crypto.randomUUID();
    await expect(
      db.insert(coupons).values({
        id: crypto.randomUUID(),
        code: "DXV-RACE1",
        campaignId: CAMPAIGN_B,
        tierId: TIER_B,
        userId: USER_ID,
        amount: 1_000,
        status: "held",
        activeHolder: other,
        validUntil: daysFromNow(5),
        claimedAt: new Date().toISOString(),
      }),
    ).resolves.toBeDefined();
    await expectUniqueViolation(() =>
      db.insert(coupons).values({
        id: crypto.randomUUID(),
        code: "DXV-RACE2",
        campaignId: CAMPAIGN_C,
        tierId: TIER_C,
        userId: USER_ID,
        amount: 1_000,
        status: "held",
        activeHolder: other, // same holder again
        validUntil: daysFromNow(5),
        claimedAt: new Date().toISOString(),
      }),
    );
  });

  it("rejects duplicate coupon codes and duplicate campaign claims", async () => {
    const db = await getDb();
    // A real extra account (user_id is FK-constrained).
    const dupUser = crypto.randomUUID();
    await db.insert(users).values({
      id: dupUser,
      fullName: "Dup User",
      email: "dup@test.vn",
      role: "user",
      status: "active",
    });
    await db.insert(coupons).values({
      id: crypto.randomUUID(),
      code: "DXV-DUPCODE",
      campaignId: CAMPAIGN_A,
      tierId: TIER_A,
      userId: dupUser,
      amount: 1_000,
      status: "expired",
      claimedAt: new Date().toISOString(),
    });
    await expectUniqueViolation(() =>
      db.insert(coupons).values({
        id: crypto.randomUUID(),
        code: "DXV-DUPCODE",
        campaignId: CAMPAIGN_B,
        tierId: TIER_B,
        userId: USER_ID,
        amount: 1_000,
        status: "expired",
        claimedAt: new Date().toISOString(),
      }),
    ); // code collision across accounts

    await db.insert(coupons).values({
      id: crypto.randomUUID(),
      code: "DXV-DUPCA1",
      campaignId: CAMPAIGN_B,
      tierId: TIER_B,
      userId: dupUser,
      amount: 1_000,
      status: "released",
      claimedAt: new Date().toISOString(),
    });
    await expectUniqueViolation(() =>
      db.insert(coupons).values({
        id: crypto.randomUUID(),
        code: "DXV-DUPCA2",
        campaignId: CAMPAIGN_B,
        tierId: TIER_B,
        userId: dupUser,
        amount: 1_000,
        status: "held",
        activeHolder: dupUser,
        validUntil: daysFromNow(5),
        claimedAt: new Date().toISOString(),
      }),
    );
  });
});
