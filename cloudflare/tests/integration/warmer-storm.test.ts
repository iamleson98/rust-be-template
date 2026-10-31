import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobRuns, tripSessions } from "@/lib/db/schema";
import { setCloudflareContext } from "../helpers/context";
import { addBrand, addLayout, addRoute, addSchedule, vnDay } from "../helpers/catalog";
import { tick, triggerCronJob, LIVE_RUN_MAX_AGE_MS } from "@/lib/services/jobs";
import { SELL_WINDOW_DAYS, WARM_SLICE_SCHEDULES, warmTrips } from "@/lib/services/trip-warmer";
import { migrate } from "../helpers/fixture";

/**
 * The warmer storm of 2026-10-31, as regression tests:
 *  - a Worker killed by the CPU cap mid-warm records nothing, and the tick
 *    gate used to retry the unbounded warm EVERY MINUTE, starving the whole
 *    Worker. The claim row must be written before the body, and the warm
 *    pass must be sliced so one invocation can never load the whole catalog.
 *  - a stale `running` claim (the row a killed Worker leaves behind) must
 *    not block manual job triggers forever.
 */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await (await getDb()).delete(jobRuns);
});

describe("the warmer claim", () => {
  it("writes a claim row before warming, so a killed attempt still gates the tick", async () => {
    await tick();
    const rows = (await getDb()).select().from(jobRuns).where(eq(jobRuns.jobType, "trips.warm"));
    const statuses = (await rows).map((r) => r.status);
    // The claim ('running') is recorded even if the body never finishes.
    expect(statuses).toContain("running");
    expect(statuses).toContain("succeeded");
  });

  it("does not retry trips.warm while a claim from a killed Worker is fresh", async () => {
    const db = await getDb();
    await db.insert(jobRuns).values({
      id: crypto.randomUUID(),
      jobType: "trips.warm",
      status: "running", // what a CPU-killed invocation leaves behind
    });
    await tick();
    const rows = await db.select().from(jobRuns).where(eq(jobRuns.jobType, "trips.warm"));
    expect(rows).toHaveLength(1); // no second attempt within the interval
  });

  it("retries trips.warm once the claim has aged past the interval", async () => {
    const db = await getDb();
    const stale = new Date(Date.now() - 11 * 60_000).toISOString();
    await db.insert(jobRuns).values({
      id: crypto.randomUUID(),
      jobType: "trips.warm",
      status: "running",
      createdAt: stale,
      startedAt: stale,
      finishedAt: stale,
    });
    await tick();
    const rows = await db.select().from(jobRuns).where(eq(jobRuns.jobType, "trips.warm"));
    expect(rows.length).toBeGreaterThan(1); // the next pass went ahead
  });
});

describe("sliced warming", () => {
  it("warms one bounded (date, page) slice per invocation and converges over a full rotation", async () => {
    const brandId = await addBrand();
    const layout = await addLayout(brandId, 4);
    const routeId = await addRoute(brandId);
    const n = WARM_SLICE_SCHEDULES + 5;
    for (let i = 0; i < n; i++) {
      await addSchedule(routeId, { busLayoutId: layout.id, departureTime: "08:00" });
    }
    const pages = Math.ceil(n / WARM_SLICE_SCHEDULES);
    const slots = SELL_WINDOW_DAYS * pages;

    // One invocation materializes at most one page of one date — never the
    // whole catalog at once.
    const first = await warmTrips(0);
    expect(first.created).toBe(WARM_SLICE_SCHEDULES);

    // A full rotation of slots covers every (date, page) pair exactly once.
    let created = first.created;
    for (let slot = 1; slot < slots; slot++) created += (await warmTrips(slot)).created;
    expect(created).toBe(n * SELL_WINDOW_DAYS);

    // Sweeping the rotation again finds nothing missing.
    expect((await warmTrips(0)).created).toBe(0);

    const db = await getDb();
    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(tripSessions)
      .where(eq(tripSessions.departureDate, vnDay(0)));
    expect(Number(total)).toBe(n);
  });
});

describe("stale claims and manual triggers", () => {
  it("does not let a stale running claim block a manual trigger", async () => {
    const db = await getDb();
    const stale = new Date(Date.now() - (LIVE_RUN_MAX_AGE_MS + 60_000)).toISOString();
    await db.insert(jobRuns).values({
      id: crypto.randomUUID(),
      jobType: "trips.prune",
      status: "running",
      createdAt: stale,
      startedAt: stale,
      finishedAt: stale,
    });
    const run = await triggerCronJob("trips.prune");
    expect(run.status).toBe("succeeded");
  });
});
