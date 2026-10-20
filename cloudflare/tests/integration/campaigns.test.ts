import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration4 from "../../migrations/0004_deep_callisto.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { signAccessToken } from "@/lib/auth/jwt";
import { ApiError } from "@/lib/auth/rbac";
import { createBooking } from "@/lib/services/booking";
import { claimCoupon, newCouponCode } from "@/lib/services/campaign-claim";
import { CAMPAIGN_CODES } from "@/lib/services/campaign-codes";
import { campaignState } from "@/lib/services/campaign-out";
import {
  clearCampaignMemory,
  invalidateCampaigns,
  publicCampaigns,
} from "@/lib/services/campaign-public";
import {
  brands,
  busLayouts,
  coupons,
  discountCampaignBrands,
  discountCampaigns,
  discountTiers,
  routes,
  schedules,
  seats,
  tripSessions,
  users,
} from "@/lib/db/schema";

/**
 * Ports of the Rust `src/service/campaign_tests.rs` cases that cover the
 * claim, the stable error codes, brand scope and the public list cache,
 * run against a real D1 inside workerd. Each test builds its own users and
 * campaigns so none depends on another's leftovers.
 */

const day = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

let nextEmail = 0;
async function user(role = "user", over: Partial<typeof users.$inferInsert> = {}) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(users).values({
    id,
    fullName: "Khách",
    email: `c${nextEmail++}-${id.slice(0, 8)}@test.vn`,
    role,
    status: "active",
    locale: "vi",
    ...over,
  });
  return id;
}

interface CampaignOpts {
  name?: string;
  startsAt?: string;
  endsAt?: string;
  paused?: boolean;
  couponValidity?: "campaign" | "permanent";
  brandIds?: string[];
  /** `[amount, totalSlots]` per tier, in the order given. */
  tiers?: Array<[number, number]>;
}

/** A campaign running since an hour ago for a week, like Rust's `input`. */
async function campaign(o: CampaignOpts = {}) {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.insert(discountCampaigns).values({
    id,
    name: o.name ?? "Khai trương",
    startsAt: o.startsAt ?? at(-3_600_000),
    endsAt: o.endsAt ?? at(7 * day),
    couponValidity: o.couponValidity ?? "campaign",
    allBrands: !o.brandIds,
    paused: o.paused ?? false,
  });
  for (const brandId of o.brandIds ?? [])
    await db.insert(discountCampaignBrands).values({ campaignId: id, brandId });
  const tierIds: string[] = [];
  for (const [i, [amount, totalSlots]] of (o.tiers ?? [[50_000, 10]]).entries()) {
    const tierId = crypto.randomUUID();
    tierIds.push(tierId);
    await db
      .insert(discountTiers)
      .values({ id: tierId, campaignId: id, amount, totalSlots, position: i });
  }
  return { id, tierIds };
}

async function claimedSlots(tierId: string) {
  const db = await getDb();
  return (await db.select().from(discountTiers).where(eq(discountTiers.id, tierId)))[0]
    .claimedSlots;
}

/** The `ApiError` a failing claim throws (failing the test if it succeeds). */
async function refused(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected the call to be refused");
}

async function listed(id: string) {
  const list = await publicCampaigns();
  return list.items.find((c) => c.id === id);
}

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration4);
});

beforeEach(async () => {
  clearCampaignMemory();
  await invalidateCampaigns();
});

describe("coupon codes", () => {
  it("are DXV + 7 characters of the unambiguous alphabet, never repeating", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const code = newCouponCode();
      expect(code).toMatch(/^DXV[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(2000);
  });
});

describe("only customer accounts can claim", () => {
  it("refuses staff, guests, bots and blocked accounts with customers_only (403)", async () => {
    const { id, tierIds } = await campaign();
    const accounts = [
      await user("employee"),
      await user("admin"),
      await user("user", { isGuest: true }),
      await user("user", { isBot: true }),
      await user("user", { status: "blocked" }),
    ];
    for (const who of accounts) {
      const e = await refused(claimCoupon(who, null, id, tierIds[0]));
      expect([e.status, e.code, e.message]).toEqual([403, "forbidden", "customers_only"]);
    }
    expect(await claimedSlots(tierIds[0])).toBe(0);
  });
});

describe("one coupon held at a time and one per campaign", () => {
  it("returns the stable codes, then frees the account (and the slot) on give-up", async () => {
    const first = await campaign({
      tiers: [
        [50_000, 10],
        [20_000, 10],
      ],
    });
    const second = await campaign({ tiers: [[30_000, 10]] });
    const customer = await user();

    const coupon = await claimCoupon(customer, null, first.id, first.tierIds[0]);
    expect([coupon.amount, coupon.status]).toEqual([50_000, "held"]);
    expect(coupon.code).toMatch(/^DXV[A-Z2-9]{7}$/);
    expect(coupon.campaignName).toBe("Khai trương");

    // Holding one: no second coupon, from any campaign.
    for (const [c, t] of [
      [first.id, first.tierIds[1]],
      [second.id, second.tierIds[0]],
    ]) {
      const e = await refused(claimCoupon(customer, null, c, t));
      expect([e.status, e.code, e.message]).toEqual([409, "conflict", "coupon_already_held"]);
    }

    // Giving it up frees the account and the slot, but not the campaign.
    const { DELETE } = await import("../../src/app/api/coupons/mine/route");
    const token = await signAccessToken(customer);
    const giveUp = () =>
      DELETE(
        new Request("https://datxevui.com/api/coupons/mine", {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
        }),
      );
    expect((await giveUp()).status).toBe(200);
    expect(await claimedSlots(first.tierIds[0])).toBe(0);
    const again = await refused(claimCoupon(customer, null, first.id, first.tierIds[1]));
    expect([again.status, again.message]).toEqual([409, "campaign_already_claimed"]);
    await claimCoupon(customer, null, second.id, second.tierIds[0]);

    // Nothing held (a booked coupon cannot be given up either): 404, not a second release.
    const db = await getDb();
    await db.update(coupons).set({ status: "reserved" }).where(eq(coupons.userId, customer));
    const nothing = await giveUp();
    expect(nothing.status).toBe(404);
    expect(await nothing.json()).toEqual({
      error: { code: "not_found", message: "no unused coupon to give up" },
    });
    expect(await claimedSlots(second.tierIds[0])).toBe(1);
  });

  it("answers the claim route with the {error:{code,message}} envelope", async () => {
    const { id, tierIds } = await campaign();
    const staff = await user("employee");
    const { POST } = await import("../../src/app/api/campaigns/[id]/tiers/[tierId]/claim/route");
    const res = await POST(
      new Request(`https://datxevui.com/api/campaigns/${id}/tiers/${tierIds[0]}/claim`, {
        method: "POST",
        headers: { authorization: `Bearer ${await signAccessToken(staff)}` },
      }),
      { params: Promise.resolve({ id, tierId: tierIds[0] }) },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "forbidden", message: "customers_only" } });
  });
});

describe("claims never oversell", () => {
  it("12 concurrent claims of a 3-slot tier: 3 coupons, the rest tier_sold_out (410)", async () => {
    const { id, tierIds } = await campaign({ tiers: [[50_000, 3]] });
    const customers = await Promise.all(Array.from({ length: 12 }, () => user()));
    const results = await Promise.allSettled(
      customers.map((c) => claimCoupon(c, null, id, tierIds[0])),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(3);
    for (const r of results) {
      if (r.status === "rejected") {
        const e = r.reason as ApiError;
        expect([e.status, e.code, e.message]).toEqual([410, "gone", "tier_sold_out"]);
      }
    }
    const db = await getDb();
    expect(await claimedSlots(tierIds[0])).toBe(3);
    expect(await db.select().from(coupons).where(eq(coupons.tierId, tierIds[0]))).toHaveLength(3);
  });

  it("a code collision rolls the whole claim back: no slot leaks, and the retry succeeds", async () => {
    const { id, tierIds } = await campaign({ tiers: [[50_000, 5]] });
    const [a, b] = [await user(), await user()];
    const fixed = (bytes: Uint8Array) => bytes.fill(7);
    const spy = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation(((bytes: Uint8Array) => fixed(bytes)) as typeof crypto.getRandomValues);
    try {
      await claimCoupon(a, null, id, tierIds[0]);
      // b's codes collide with a's on both tries: try_again, nothing leaked.
      const e = await refused(claimCoupon(b, null, id, tierIds[0]));
      expect([e.status, e.code, e.message]).toEqual([409, "conflict", "try_again"]);
      expect(await claimedSlots(tierIds[0])).toBe(1);
      // A fresh code on the second try goes through (Rust retries once).
      spy.mockRestore();
      let calls = 0;
      const real = crypto.getRandomValues.bind(crypto);
      vi.spyOn(crypto, "getRandomValues").mockImplementation(((bytes: Uint8Array) => {
        return calls++ === 0 ? fixed(bytes) : real(bytes);
      }) as typeof crypto.getRandomValues);
      await claimCoupon(b, null, id, tierIds[0]);
      expect(await claimedSlots(tierIds[0])).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("a campaign that is not running takes no claims", () => {
  it("upcoming, paused, ended and foreign tiers are campaign_not_running (400)", async () => {
    const customer = await user();
    const upcoming = await campaign({ startsAt: at(day), endsAt: at(2 * day) });
    const paused = await campaign({ paused: true });
    const ended = await campaign({ startsAt: at(-3 * day), endsAt: at(-day) });
    const open = await campaign();
    const cases: Array<[string, string]> = [
      [upcoming.id, upcoming.tierIds[0]],
      [paused.id, paused.tierIds[0]],
      [ended.id, ended.tierIds[0]],
      // A tier of another campaign is not this campaign's.
      [open.id, paused.tierIds[0]],
    ];
    for (const [c, t] of cases) {
      const e = await refused(claimCoupon(customer, null, c, t));
      expect([e.status, e.code, e.message]).toEqual([400, "bad_request", "campaign_not_running"]);
    }
    expect(await claimedSlots(paused.tierIds[0])).toBe(0);
  });
});

describe("coupon validity", () => {
  it("a window coupon ends with its campaign, a permanent one never", async () => {
    const window = await campaign({ endsAt: at(5 * day) });
    const forever = await campaign({ couponValidity: "permanent" });
    const a = await claimCoupon(await user(), null, window.id, window.tierIds[0]);
    const b = await claimCoupon(await user(), null, forever.id, forever.tierIds[0]);
    const db = await getDb();
    const endsAt = (
      await db.select().from(discountCampaigns).where(eq(discountCampaigns.id, window.id))
    )[0].endsAt;
    expect(a.validUntil).toBe(endsAt);
    expect(b.validUntil).toBeNull();
  });
});

describe("a coupon only works with its operators", () => {
  let tripId = "";
  let seatIds: string[] = [];
  let brandA = "";
  let brandB = "";

  beforeAll(async () => {
    const db = await getDb();
    brandA = crypto.randomUUID();
    brandB = crypto.randomUUID();
    await db.insert(brands).values([
      { id: brandA, slug: "nha-xe-a", name: "Nhà xe A" },
      { id: brandB, slug: "nha-xe-b", name: "Nhà xe B" },
    ]);
    const routeId = crypto.randomUUID();
    await db.insert(routes).values({
      id: routeId,
      brandId: brandA,
      name: "HN → SGN",
      startLocationId: "ha-noi",
      endLocationId: "ho-chi-minh",
    });
    const layoutId = crypto.randomUUID();
    await db.insert(busLayouts).values({ id: layoutId, name: "4 seats", totalSeats: 4 });
    seatIds = [0, 1, 2, 3].map(() => crypto.randomUUID());
    await db.insert(seats).values(
      seatIds.map((id, i) => ({
        id,
        busLayoutId: layoutId,
        seatLabel: `0${i + 1}`,
        rowNum: 1,
        colNum: i + 1,
        floor: 1,
      })),
    );
    const scheduleId = crypto.randomUUID();
    await db.insert(schedules).values({
      id: scheduleId,
      routeId,
      departureTime: "08:00",
      busLayoutId: layoutId,
      basePriceAdult: 100_000,
    });
    tripId = crypto.randomUUID();
    await db.insert(tripSessions).values({
      id: tripId,
      scheduleId,
      departureDate: at(3 * day).slice(0, 10),
      totalSeats: 4,
      availableSeats: 4,
    });
  });

  const hold = (userId: string, seat: number, couponId?: string) =>
    createBooking(userId, {
      tripId,
      seatIds: [seatIds[seat]],
      passengers: [{ name: "Hành khách", type: "adult" }],
      contactName: "Khách",
      contactPhone: "0900123456",
      couponId,
    });

  it("refuses another operator's coupon (coupon_not_for_this_operator, 400) and leaves it held", async () => {
    const scoped = await campaign({ brandIds: [brandB] });
    const customer = await user();
    const coupon = await claimCoupon(customer, null, scoped.id, scoped.tierIds[0]);
    expect(coupon.brands.map((b) => b.id)).toEqual([brandB]);

    const e = await refused(hold(customer, 0, coupon.id));
    expect([e.status, e.code, e.message]).toEqual([
      400,
      "bad_request",
      "coupon_not_for_this_operator",
    ]);
    const db = await getDb();
    const row = (await db.select().from(coupons).where(eq(coupons.id, coupon.id)))[0];
    expect([row.status, row.bookingId]).toEqual(["held", null]);
  });

  it("takes its own operator's coupon, and an all-brands coupon anywhere", async () => {
    const own = await campaign({ brandIds: [brandA, brandB], tiers: [[30_000, 5]] });
    const customer = await user();
    const coupon = await claimCoupon(customer, null, own.id, own.tierIds[0]);
    const booking = await hold(customer, 1, coupon.id);
    expect(booking.discount).toBe(30_000);

    const all = await campaign({ tiers: [[500_000, 5]] });
    const other = await user();
    const big = await claimCoupon(other, null, all.id, all.tierIds[0]);
    // A discount never exceeds the ticket.
    const capped = await hold(other, 2, big.id);
    expect([capped.discount, capped.total]).toEqual([100_000, 0]);
  });

  it("only the holder can use it: coupon_unavailable (400)", async () => {
    const c = await campaign();
    const owner = await user();
    const coupon = await claimCoupon(owner, null, c.id, c.tierIds[0]);
    const thief = await user();
    for (const [who, id] of [
      [thief, coupon.id],
      [owner, crypto.randomUUID()],
    ]) {
      const e = await refused(hold(who, 3, id));
      expect([e.status, e.code, e.message]).toEqual([400, "bad_request", "coupon_unavailable"]);
    }
  });
});

describe("campaign state", () => {
  const row = (over: Partial<typeof discountCampaigns.$inferSelect>) =>
    ({ startsAt: at(-day), endsAt: at(day), paused: false, ...over }) as Parameters<
      typeof campaignState
    >[0];
  it("is ended > paused > upcoming > running (Rust state_of)", () => {
    const now = new Date().toISOString();
    expect(campaignState(row({}), now)).toBe("running");
    expect(campaignState(row({ startsAt: at(day), endsAt: at(2 * day) }), now)).toBe("upcoming");
    expect(campaignState(row({ paused: true }), now)).toBe("paused");
    expect(campaignState(row({ paused: true, startsAt: at(day), endsAt: at(2 * day) }), now)).toBe(
      "paused",
    );
    expect(
      campaignState(row({ paused: true, startsAt: at(-2 * day), endsAt: at(-day) }), now),
    ).toBe("ended");
    // The end instant itself is already ended.
    expect(campaignState(row({ endsAt: now }), now)).toBe("ended");
  });
});

describe("the public list", () => {
  it("shows running and upcoming campaigns, hides paused and ended, tiers biggest first", async () => {
    const running = await campaign({
      tiers: [
        [20_000, 5],
        [50_000, 3],
        [30_000, 4],
      ],
    });
    const soon = await campaign({ startsAt: at(2 * day), endsAt: at(3 * day) });
    const paused = await campaign({ paused: true });
    const ended = await campaign({ startsAt: at(-3 * day), endsAt: at(-day) });

    const list = await publicCampaigns();
    const ids = list.items.map((c) => c.id);
    expect(ids).toContain(running.id);
    expect(ids).toContain(soon.id);
    expect(ids).not.toContain(paused.id);
    expect(ids).not.toContain(ended.id);
    expect((await listed(running.id))?.tiers.map((t) => t.amount)).toEqual([
      50_000, 30_000, 20_000,
    ]);
    // Earliest start first, like Rust's `list_live_campaigns`.
    expect(ids.indexOf(running.id)).toBeLessThan(ids.indexOf(soon.id));
  });

  it("is cached, kept current by claims, and reloaded when a tier sells out", async () => {
    const { id, tierIds } = await campaign({ tiers: [[50_000, 3]] });
    expect((await listed(id))?.tiers[0].remaining).toBe(3);

    // Renamed behind the service's back: reads keep coming from the cache.
    const db = await getDb();
    await db.update(discountCampaigns).set({ name: "Đổi tên" }).where(eq(discountCampaigns.id, id));

    // A claim writes its exact count into the cached list without a reload.
    await claimCoupon(await user(), null, id, tierIds[0]);
    let c = await listed(id);
    expect([c?.name, c?.tiers[0].remaining]).toEqual(["Khai trương", 2]);

    // Selling the tier out clears the cache: the next read loads afresh.
    for (let i = 0; i < 2; i++) await claimCoupon(await user(), null, id, tierIds[0]);
    c = await listed(id);
    expect([c?.name, c?.tiers[0].remaining]).toEqual(["Đổi tên", 0]);
  });

  it("a coupon given up clears it, so the freed slot shows at once", async () => {
    const { id, tierIds } = await campaign({ tiers: [[50_000, 2]] });
    const customer = await user();
    await claimCoupon(customer, null, id, tierIds[0]);
    expect((await listed(id))?.tiers[0].remaining).toBe(1);

    const { DELETE } = await import("../../src/app/api/coupons/mine/route");
    const res = await DELETE(
      new Request("https://datxevui.com/api/coupons/mine", {
        method: "DELETE",
        headers: { authorization: `Bearer ${await signAccessToken(customer)}` },
      }),
    );
    expect(res.status).toBe(200);
    expect((await listed(id))?.tiers[0].remaining).toBe(2);
  });

  it("an admin write clears it", async () => {
    const admin = await user("admin");
    const { id } = await campaign({ name: "Trước" });
    expect((await listed(id))?.name).toBe("Trước");

    const { PATCH } = await import("../../src/app/api/admin/campaigns/[id]/route");
    const res = await PATCH(
      new Request(`https://datxevui.com/api/admin/campaigns/${id}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${await signAccessToken(admin)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Sau",
          startsAt: at(-3_600_000),
          endsAt: at(7 * day),
          couponValidity: "campaign",
          allBrands: true,
          tiers: [{ amount: 10_000, totalSlots: 5 }],
        }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect((await listed(id))?.name).toBe("Sau");
  });

  it("serves another isolate from the colo's Cache API entry, until it is invalidated", async () => {
    const { id } = await campaign({ name: "Một" });
    expect((await listed(id))?.name).toBe("Một");
    const db = await getDb();
    await db.update(discountCampaigns).set({ name: "Hai" }).where(eq(discountCampaigns.id, id));

    clearCampaignMemory(); // a cold isolate: no local copy, the edge entry is still there
    expect((await listed(id))?.name).toBe("Một");
    await invalidateCampaigns();
    expect((await listed(id))?.name).toBe("Hai");
  });

  it("trims a campaign that ended since it was cached, and always sets a fresh serverTime", async () => {
    const { id } = await campaign({ startsAt: at(-day), endsAt: at(700) });
    const first = await publicCampaigns();
    expect(first.items.map((c) => c.id)).toContain(id);

    await new Promise((r) => setTimeout(r, 900));
    const second = await publicCampaigns(); // the cached copy is still within its TTL
    expect(second.items.map((c) => c.id)).not.toContain(id);
    expect(Date.parse(second.serverTime)).toBeGreaterThan(Date.parse(first.serverTime));
  });

  it("is exposed with the stable CAMPAIGN_CODES the SPA translates", () => {
    expect(Object.values(CAMPAIGN_CODES).sort()).toEqual(
      [
        "customers_only",
        "campaign_not_running",
        "coupon_already_held",
        "campaign_already_claimed",
        "tier_sold_out",
        "try_again",
        "coupon_unavailable",
        "coupon_expired",
        "coupon_not_for_this_operator",
      ].sort(),
    );
  });
});
