import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { sweepExpiredHolds } from "@/lib/services/booking";
import {
  bookings,
  brands,
  busLayouts,
  routes,
  schedules,
  tripSessions,
  users,
} from "@/lib/db/schema";

/**
 * D1 caps bound parameters at 100 per statement. The sweep binds its id list
 * in several statements, so a backlog (say after an outage) larger than ~30
 * used to fail on every tick and never drain.
 */
const BACKLOG = 130;
const USER_ID = "33333333-3333-4333-8333-333333333333";
let TRIP_ID = "";

beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2);
  const db = await getDb();
  await db.insert(users).values({
    id: USER_ID,
    fullName: "Sweep Tester",
    email: "sweep@test.vn",
    role: "user",
    status: "active",
    locale: "vi",
  });
  const brandId = crypto.randomUUID();
  await db.insert(brands).values({ id: brandId, slug: "sweep-bus", name: "Sweep Bus" });
  const routeId = crypto.randomUUID();
  await db.insert(routes).values({
    id: routeId,
    brandId,
    name: "HN → SGN",
    startLocationId: "ha-noi",
    endLocationId: "ho-chi-minh",
  });
  const layoutId = crypto.randomUUID();
  await db.insert(busLayouts).values({ id: layoutId, name: "layout", totalSeats: 2 });
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
    departureDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
    totalSeats: 2,
    availableSeats: 0,
  });
  const past = new Date(Date.now() - 3_600_000).toISOString();
  const now = new Date().toISOString();
  for (let i = 0; i < BACKLOG; i++) {
    await db.insert(bookings).values({
      id: crypto.randomUUID(),
      code: `SWP${String(i).padStart(4, "0")}`,
      userId: USER_ID,
      tripSessionId: TRIP_ID,
      subtotal: 100_000,
      total: 100_000,
      status: "pending",
      expiresAt: past,
      contactName: "x",
      contactPhone: "0900000000",
      createdAt: now,
      updatedAt: now,
    });
  }
});

describe("sweepExpiredHolds", () => {
  it("drains a backlog larger than D1's bound-parameter limit", async () => {
    let cancelled = 0;
    for (let run = 0; run < 3; run++) cancelled += (await sweepExpiredHolds()).cancelled;
    expect(cancelled).toBe(BACKLOG);
    const left = await (
      await getDb()
    )
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.status, "pending"));
    expect(left).toHaveLength(0);
  });
});
