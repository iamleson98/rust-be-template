import { beforeAll, describe, expect, it } from "vitest";
import migration0 from "../../migrations/0000_init_domain.sql?raw";
import migration1 from "../../migrations/0001_fts_and_seeds.sql?raw";
import migration2 from "../../migrations/0002_realtime_meeting_id.sql?raw";
import migration5 from "../../migrations/0005_repair_literal_timestamps.sql?raw";
import migration6 from "../../migrations/0006_drop_fts_reindex_job.sql?raw";
import { setCloudflareContext } from "../helpers/context";
import { applyMigrations } from "../helpers/migrate";
import { getDb } from "@/lib/db/client";
import { and, eq, lt } from "drizzle-orm";
import { tick } from "@/lib/services/jobs";
import { jobRuns, scheduledJobs } from "@/lib/db/schema";

/**
 * Cron ticks can overlap (a slow run, the admin "trigger" button, a retried
 * Cron Trigger). A table-driven job must run once per slot regardless.
 */
beforeAll(async () => {
  setCloudflareContext();
  await applyMigrations(migration0, migration1, migration2, migration5, migration6);
});

async function runsOf(jobType: string): Promise<number> {
  const db = await getDb();
  return (await db.select().from(jobRuns).where(eq(jobRuns.jobType, jobType))).length;
}

describe("scheduled job claims", () => {
  it("runs a due job exactly once when ticks overlap, then advances its slot", async () => {
    const db = await getDb();
    const due = new Date(Date.now() - 60_000).toISOString();
    await db
      .update(scheduledJobs)
      .set({ nextRunAt: due })
      .where(eq(scheduledJobs.jobType, "coupons.expire"));

    await Promise.all([tick(), tick(), tick()]);

    expect(await runsOf("coupons.expire")).toBe(1);
    const row = (
      await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, "coupons.expire"))
    )[0];
    expect(new Date(row.nextRunAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    await tick(); // not due any more
    expect(await runsOf("coupons.expire")).toBe(1);
  });

  it("initialises next_run_at on the first tick without running early", async () => {
    const db = await getDb();
    await db
      .update(scheduledJobs)
      .set({ nextRunAt: null })
      .where(eq(scheduledJobs.jobType, "trips.prune"));
    await tick();
    const row = (
      await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, "trips.prune"))
    )[0];
    expect(row.nextRunAt).not.toBeNull();
    expect(await runsOf("trips.prune")).toBe(0);
  });

  it("retires the FTS reindex job", async () => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(scheduledJobs)
      .where(and(eq(scheduledJobs.jobType, "fts.reindex")));
    expect(rows).toHaveLength(0);
  });
});

/**
 * D1's Free plan allows 5M rows read per day and the cron fires 1,440 times a
 * day, so the tick may not scan job_run. (Production burned 41M reads in a week
 * on `DELETE ... WHERE created_at < ?` and an unindexed `status` lookup.)
 */
describe("tick cost on the free plan", () => {
  it("writes one heartbeat for a stretch of idle sweeps, not one row per tick", async () => {
    const db = await getDb();
    await db.delete(jobRuns).where(eq(jobRuns.jobType, "holds.sweep"));
    for (let i = 0; i < 5; i++) await tick();
    expect(await runsOf("holds.sweep")).toBe(1);
  });

  it("never prunes job_run on the hot path (the daily retention job does)", async () => {
    const db = await getDb();
    const old = new Date(Date.now() - 45 * 86_400_000).toISOString();
    await db.insert(jobRuns).values({
      id: crypto.randomUUID(),
      jobType: "holds.sweep",
      status: "succeeded",
      createdAt: old,
      startedAt: old,
      finishedAt: old,
    });
    await tick();
    const left = await db
      .select()
      .from(jobRuns)
      .where(lt(jobRuns.createdAt, old + "~"));
    expect(left.some((r) => r.createdAt === old)).toBe(true);
  });
});
