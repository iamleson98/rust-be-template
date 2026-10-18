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
import { jobRuns, scheduledJobs } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
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
      const r = await db.run(sql`
        UPDATE coupon SET status = 'expired', updated_at = ${new Date().toISOString()}
        WHERE status = 'held'
          AND valid_until IS NOT NULL
          AND valid_until < ${new Date().toISOString()}
      `);
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
      const r = await db.run(sql`
        DELETE FROM seat_inventory
        WHERE status = 'available'
          AND trip_session_id IN (
            SELECT ts.id FROM trip_session ts WHERE ts.departure_date < ${today}
          )
      `);
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
  const lastWarmRows = await rawAll<{ finished_at: string }>(
    sql`SELECT finished_at FROM job_run WHERE job_type = 'trips.warm' AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1`,
  );
  const lastWarm = lastWarmRows[0]?.finished_at ?? null;
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
  const rows = await rawAll<CronJobRunOut>(sql`
    SELECT id, job_type AS jobType, status, detail, error, started_at AS startedAt,
           finished_at AS finishedAt, created_at AS createdAt
    FROM job_run WHERE job_type = ${jobType}
    ORDER BY created_at DESC LIMIT 1
  `);
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
  await db.run(sql`
    UPDATE job_run SET status = 'cancelled', finished_at = ${now}, error = 'cancelled by admin'
    WHERE job_type = ${jobType} AND status = 'running'
  `);
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

export async function listJobsWithRuns() {
  const db = await getDb();
  const jobs = await db.select().from(scheduledJobs);
  const recentRuns = await rawAll<{
    job_type: string;
    status: string;
    detail: string | null;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>(sql`
      SELECT job_type, status, detail, error, started_at, finished_at
      FROM job_run ORDER BY created_at DESC LIMIT 100
    `);
  return { jobs, recentRuns };
}
