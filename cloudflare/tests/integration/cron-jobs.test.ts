import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobRuns, scheduledJobs } from "@/lib/db/schema";
import { setCloudflareContext } from "../helpers/context";
import { nextOccurrence } from "@/lib/scheduler";
import {
  cancelCronJob,
  listCronJobs,
  listCronRuns,
  tick,
  triggerCronJob,
  updateCronJob,
  validateUpdateCronJob,
} from "@/lib/services/jobs";
import { migrate, rejection } from "../helpers/fixture";

/**
 * The admin schedule API of Rust `job_service.rs`: listing, patching with
 * validation, manual trigger and cancel, and how slots follow the
 * operator's (Vietnam) wall clock.
 */

beforeAll(migrate);
beforeEach(async () => {
  setCloudflareContext();
  await (await getDb()).delete(jobRuns);
});

describe("listing", () => {
  it("shows every schedule with its catalogue description, plus the two fixed-cadence jobs", async () => {
    const { items } = await listCronJobs();
    const byType = Object.fromEntries(items.map((i) => [i.jobType, i]));
    expect(Object.keys(byType)).toEqual(
      expect.arrayContaining([
        "holds.sweep",
        "trips.warm",
        "coupons.expire",
        "jobs.retention",
        "trips.prune",
      ]),
    );
    expect(byType["coupons.expire"]).toMatchObject({
      enabled: true,
      intervalDays: 1,
      atHour: 0,
      atMinute: 10,
      lastRun: null,
    });
    expect(byType["coupons.expire"]!.description).toContain("Expire unused discount coupons");
  });

  it("reports the scheduler alive while the sweep has run in the last five minutes", async () => {
    expect((await listCronJobs()).schedulerEnabled).toBe(false);
    await tick();
    expect((await listCronJobs()).schedulerEnabled).toBe(true);
  });

  it("lists runs newest first, 20 by default, at most 100, optionally for one job", async () => {
    await tick();
    await triggerCronJob("coupons.expire");
    expect((await listCronRuns("coupons.expire", 20)).items.map((r) => r.jobType)).toEqual([
      "coupons.expire",
    ]);
    expect((await listCronRuns(null, 0)).items).toHaveLength(1); // limit clamps up to 1
  });
});

describe("patching a schedule", () => {
  it("validates the ranges", () => {
    for (const bad of [
      { intervalDays: 0 },
      { intervalDays: 366 },
      { atHour: 24 },
      { atMinute: 60 },
      { atHour: 1.5 },
    ])
      expect(() => validateUpdateCronJob(bad), JSON.stringify(bad)).toThrow();
    expect(() =>
      validateUpdateCronJob({ intervalDays: 365, atHour: 23, atMinute: 59 }),
    ).not.toThrow();
  });

  it("404s a job that has no schedule instead of inventing one", async () => {
    expect(await rejection(updateCronJob("nope", { enabled: false }))).toEqual({
      status: 404,
      message: 'no schedule for job "nope"',
    });
    expect((await rejection(updateCronJob("holds.sweep", {}))).status).toBe(404); // fixed cadence: no row
  });

  it("a new time of day re-arms the next run on the Vietnam clock", async () => {
    const out = await updateCronJob("coupons.expire", { atHour: 2, atMinute: 30 });
    expect(out).toMatchObject({ atHour: 2, atMinute: 30, intervalDays: 1 });
    const expected = nextOccurrence(new Date(), 2, 30, 420);
    expect(Math.abs(Date.parse(out.nextRunAt!) - expected.getTime())).toBeLessThan(5_000);
  });

  it("disabling keeps the next run; enabling alone does not re-arm it", async () => {
    const before = (await updateCronJob("jobs.retention", { resetNextRun: true })).nextRunAt;
    expect(before).not.toBeNull();
    const off = await updateCronJob("jobs.retention", { enabled: false });
    expect(off).toMatchObject({ enabled: false, nextRunAt: before });
    expect((await updateCronJob("jobs.retention", { enabled: true })).nextRunAt).toBe(before);
  });
});

describe("running now", () => {
  it("triggers a catalogue job and answers the finished run with its detail as JSON", async () => {
    const run = await triggerCronJob("coupons.expire");
    expect(run).toMatchObject({
      jobType: "coupons.expire",
      status: "succeeded",
      detail: { expired: 0 },
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it("404s an unknown job and 409s one that is already running", async () => {
    expect(await rejection(triggerCronJob("osm.import"))).toEqual({
      status: 404,
      message: 'no job "osm.import"',
    });
    await (
      await getDb()
    )
      .insert(jobRuns)
      .values({ id: crypto.randomUUID(), jobType: "trips.prune", status: "running" });
    expect((await rejection(triggerCronJob("trips.prune"))).status).toBe(409);
  });

  it("cancels only a queued or running run", async () => {
    expect((await rejection(cancelCronJob("trips.prune"))).status).toBe(404);
    const id = crypto.randomUUID();
    await (await getDb()).insert(jobRuns).values({ id, jobType: "trips.prune", status: "queued" });
    expect(await cancelCronJob("trips.prune")).toMatchObject({ id, status: "cancelled" });
    expect((await rejection(cancelCronJob("trips.prune"))).status).toBe(404);
  });
});

describe("the tick", () => {
  it("advances a finished job to the next slot of its Vietnam wall-clock time", async () => {
    const db = await getDb();
    await db
      .update(scheduledJobs)
      .set({ nextRunAt: new Date(Date.now() - 60_000).toISOString(), atHour: 3, atMinute: 15 })
      .where(eq(scheduledJobs.jobType, "coupons.expire"));
    await tick();
    const row = (
      await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, "coupons.expire"))
    )[0]!;
    const next = new Date(row.nextRunAt!);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect([next.getUTCHours(), next.getUTCMinutes()]).toEqual([20, 15]); // 03:15 +07 = 20:15 UTC
  });
});
