/**
 * Jobs service — the cron EXECUTOR. The DRIVER is the container
 * (cloudflare/container), which ticks every minute and calls
 * POST /api/jobs/tick with the CRON_SERVICE_TOKEN.
 *
 * Cadences (port of the Rust scheduler + in-process timers):
 *  - holds.sweep   — fixed, every tick (60s): cancel expired pending bookings
 *  - trips.warm    — fixed, every 6h: materialize trip_session rows (14-day window)
 *  - coupons.expire / fts.reindex / jobs.retention / trips.prune —
 *    scheduled_job-table rows (daily/periodic, admin-editable via PATCH /api/admin/cron-jobs)
 *
 * All runs are recorded in job_run for the admin dashboard.
 */
import { getDb, rawAll } from "@/lib/db/client";
import { jobRuns, scheduledJobs, coupons, seatInventory } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { sweepExpiredHolds, warmTrips } from "./booking";
import { reindexPlaces } from "./place-search";
import { invalidatePlaces } from "./lookups";

export interface JobOutcome {
  jobType: string;
  status: "succeeded" | "failed" | "skipped";
  detail?: string;
  error?: string;
}

async function recordRun(jobType: string, status: string, detail?: string, error?: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.insert(jobRuns).values({
    id,
    jobType,
    status,
    detail: detail ?? null,
    error: error ?? null,
    startedAt: now,
    finishedAt: now,
  });
  // Retention prune (30 days) piggybacks on every write path.
  await db.run(
    sql`DELETE FROM job_run WHERE created_at < datetime('now', '-30 days')`,
  );
}

async function runJob(jobType: string, fn: () => Promise<string>): Promise<JobOutcome> {
  try {
    const detail = await fn();
    await recordRun(jobType, "succeeded", detail);
    return { jobType, status: "succeeded", detail };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordRun(jobType, "failed", undefined, error);
    return { jobType, status: "failed", error };
  }
}

/** Fixed frequent jobs — always run on tick. */
async function runFrequentJobs(): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  outcomes.push(
    await runJob("holds.sweep", async () => {
      const r = await sweepExpiredHolds();
      return JSON.stringify({ cancelled: r.cancelled });
    }),
  );
  return outcomes;
}

/** Table-driven jobs: run when next_run_at is due, then advance it. */
async function runDueScheduledJobs(): Promise<JobOutcome[]> {
  const db = await getDb();
  const now = new Date();
  const rows = await db.select().from(scheduledJobs).where(eq(scheduledJobs.enabled, true));
  const outcomes: JobOutcome[] = [];
  for (const job of rows) {
    // First tick after deployment: initialize next_run_at to the next slot.
    let next = job.nextRunAt ? new Date(job.nextRunAt) : null;
    if (!next) {
      next = nextSlot(job.intervalDays, job.atHour, job.atMinute);
      await db
        .update(scheduledJobs)
        .set({ nextRunAt: next.toISOString(), updatedAt: now.toISOString() })
        .where(eq(scheduledJobs.id, job.id));
      if (next.getTime() > now.getTime()) continue;
    }
    if (next.getTime() > now.getTime()) continue;

    const outcome = await runJob(job.jobType, async () => {
      const detail = await executeJobBody(job.jobType);
      // Advance to the next slot (missed slots are skipped, not replayed).
      const upcoming = nextSlot(job.intervalDays, job.atHour, job.atMinute);
      await db
        .update(scheduledJobs)
        .set({ nextRunAt: upcoming.toISOString(), updatedAt: now.toISOString() })
        .where(eq(scheduledJobs.id, job.id));
      return detail;
    });
    outcomes.push(outcome);
  }
  return outcomes;
}

async function executeJobBody(jobType: string): Promise<string> {
  const db = await getDb();
  switch (jobType) {
    case "coupons.expire": {
      // Rust `expire_held`: unused coupons whose window passed become
      // expired AND release their holder slot, freeing the owner to
      // claim again (wallet/claim paths enforce this lazily too).
      const nowIso = new Date().toISOString();
      const r = await db
        .update(coupons)
        .set({ status: "expired", activeHolder: null, updatedAt: nowIso })
        .where(
          and(
            eq(coupons.status, "held"),
            sql`${coupons.validUntil} IS NOT NULL AND ${coupons.validUntil} <= ${nowIso}`,
          ),
        );
      return JSON.stringify({ expired: r.meta.changes });
    }
    case "fts.reindex": {
      const r = await reindexPlaces();
      await invalidatePlaces();
      return JSON.stringify(r);
    }
    case "jobs.retention": {
      const r = await db.run(sql`DELETE FROM job_run WHERE created_at < datetime('now', '-30 days')`);
      return JSON.stringify({ pruned: r.meta.changes });
    }
    case "trips.prune": {
      const today = new Date().toISOString().slice(0, 10);
      const r = await db
        .delete(seatInventory)
        .where(
          and(
            eq(seatInventory.status, "available"),
            sql`${seatInventory.tripSessionId} IN (SELECT ts.id FROM trip_session ts WHERE ts.departure_date < ${today})`,
          ),
        );
      return JSON.stringify({ pruned: r.meta.changes });
    }
    case "trips.warm": {
      const r = await warmTrips();
      return JSON.stringify(r);
    }
    default:
      return JSON.stringify({ note: `unknown job type ${jobType} skipped` });
  }
}

/** Next occurrence of "every intervalDays at HH:MM" (UTC). */
function nextSlot(intervalDays: number, atHour: number, atMinute: number): Date {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setUTCHours(atHour, atMinute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + Math.max(1, intervalDays));
  }
  return candidate;
}

/** Container entry point: POST /api/jobs/tick (service-token auth). */
export async function tick(): Promise<{ ran: JobOutcome[] }> {
  const frequent = await runFrequentJobs();
  const scheduled = await runDueScheduledJobs();
  // trips.warm every 6h: gate on the last successful run.
  const db = await getDb();
  const lastWarmRows = await db
    .select({ finishedAt: jobRuns.finishedAt })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobType, "trips.warm"), eq(jobRuns.status, "succeeded")))
    .orderBy(desc(jobRuns.finishedAt))
    .limit(1);
  const lastWarm = lastWarmRows[0]?.finishedAt ?? null;
  const sixHours = 6 * 3600_000;
  if (!lastWarm || Date.now() - new Date(lastWarm).getTime() >= sixHours) {
    scheduled.push(
      await runJob("trips.warm", async () => JSON.stringify(await warmTrips())),
    );
  }
  return { ran: [...frequent, ...scheduled] };
}

/** CronJobRunOut — the SPA SDK's run row shape. */
export interface CronJobRunOut {
  id: string;
  jobType: string;
  status: string;
  detail?: string | null;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

async function latestRun(jobType: string): Promise<CronJobRunOut | null> {
  const db = await getDb();
  const rows = await db
    .select({
      id: jobRuns.id,
      jobType: jobRuns.jobType,
      status: jobRuns.status,
      detail: jobRuns.detail,
      error: jobRuns.error,
      startedAt: jobRuns.startedAt,
      finishedAt: jobRuns.finishedAt,
      createdAt: jobRuns.createdAt,
    })
    .from(jobRuns)
    .where(eq(jobRuns.jobType, jobType))
    .orderBy(desc(jobRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Admin: manual trigger (POST /api/admin/cron-jobs/{jobType}/trigger). */
export async function triggerJob(jobType: string): Promise<JobOutcome> {
  if (jobType === "holds.sweep") {
    return runJob("holds.sweep", async () =>
      JSON.stringify(await sweepExpiredHolds()),
    );
  }
  if (jobType === "trips.warm") {
    return runJob("trips.warm", async () => JSON.stringify(await warmTrips()));
  }
  return runJob(jobType, async () => executeJobBody(jobType));
}

/** Admin: latest run for the trigger response (Rust returns CronJobRunOut). */
export async function triggerJobRunOut(jobType: string): Promise<CronJobRunOut> {
  await triggerJob(jobType);
  const run = await latestRun(jobType);
  return (
    run ?? {
      id: crypto.randomUUID(),
      jobType,
      status: "succeeded",
      createdAt: new Date().toISOString(),
    }
  );
}

/** Admin: cancel an in-flight run (interrupted marker). */
export async function cancelRun(jobType: string): Promise<CronJobRunOut> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .update(jobRuns)
    .set({ status: "cancelled", finishedAt: now, error: "cancelled by admin" })
    .where(and(eq(jobRuns.jobType, jobType), eq(jobRuns.status, "running")));
  const run = await latestRun(jobType);
  return (
    run ?? {
      id: crypto.randomUUID(),
      jobType,
      status: "cancelled",
      createdAt: now,
    }
  );
}
