/**
 * Jobs service — the cron EXECUTOR. The DRIVER is the Worker's Cron Trigger
 * (every minute): custom-worker.ts `scheduled()` feeds a synthetic
 * POST /api/jobs/tick through the Next.js handler. The same route is also
 * callable with the CRON_SERVICE_TOKEN for manual runs.
 *
 * Cadences (port of the Rust scheduler + in-process timers):
 *  - holds.sweep   — fixed, every tick (60s): cancel expired pending bookings
 *  - trips.warm    — fixed, every 6h: materialize trip_session rows (14-day window)
 *  - coupons.expire / jobs.retention / trips.prune —
 *    scheduled_job-table rows (daily/periodic, admin-editable via PATCH /api/admin/cron-jobs)
 *
 * Ticks may overlap (a slow run, a manual trigger): every table-driven job is
 * CLAIMED with a compare-and-swap lease on `next_run_at` before it runs, so
 * a job never executes twice for the same slot.
 *
 * Runs are recorded in job_run for the admin dashboard. Free-plan budget (D1
 * allows 5M rows read and 100k rows written per day): the cron fires 1,440
 * times a day, so a tick may only touch indexed rows and an idle sweep writes
 * a heartbeat row every `SWEEP_HEARTBEAT_MS`, not every minute. Old rows are
 * removed by the daily `jobs.retention` job, never on the hot path.
 */
import { getDb, getEnv } from "@/lib/db/client";
import { jobRuns, scheduledJobs, coupons, seatInventory, tripSessions } from "@/lib/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { catchUp, DEFAULT_TZ_OFFSET_MINUTES, nextOccurrence } from "@/lib/scheduler";
import { badRequest, conflict, notFound } from "@/lib/services/http-errors";
import { sweepExpiredHolds, warmTrips } from "./booking";

/**
 * The job catalog (Rust `jobs::catalog`). Rust ships `osm.import` (place
 * index refresh: nothing to refresh on Workers, the shards are built at
 * deploy time) and `coupons.expire`; `holds.sweep` and `trips.warm` ran as
 * in-process timers there and run on every cron tick here.
 */
export const JOB_CATALOG: readonly { kind: string; description: string }[] = [
  {
    kind: "holds.sweep",
    description: "Cancel pending bookings whose seat hold expired (every tick).",
  },
  {
    kind: "trips.warm",
    description:
      "Materialise trip sessions and seat inventory for the sales window (every 6 hours).",
  },
  {
    kind: "coupons.expire",
    description:
      "Expire unused discount coupons whose campaign window passed (also enforced on every read; this tidies the rest).",
  },
  { kind: "jobs.retention", description: "Delete job run history older than 30 days." },
  {
    kind: "trips.prune",
    description: "Drop unsold seat inventory of trips that already departed.",
  },
];

const describe = (jobType: string) => JOB_CATALOG.find((j) => j.kind === jobType)?.description;

/** The wall clock job schedules are written in (minutes east of UTC). */
async function tzOffset(): Promise<number> {
  const raw = (await getEnv()).SCHEDULER_TZ_OFFSET_MINUTES;
  const minutes = Number(raw);
  return raw && Number.isInteger(minutes) ? minutes : DEFAULT_TZ_OFFSET_MINUTES;
}

export interface JobOutcome {
  jobType: string;
  status: "succeeded" | "failed" | "skipped";
  detail?: string;
  error?: string;
}

/** ISO cutoff for job_run retention (timestamps are ISO-8601, so compare like with like). */
function retentionCutoff(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString();
}

async function recordRun(jobType: string, status: string, detail?: string, error?: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.insert(jobRuns).values({
    id: crypto.randomUUID(),
    jobType,
    status,
    detail: detail ?? null,
    error: error ?? null,
    startedAt: now,
    finishedAt: now,
  });
}

interface RunOptions {
  /** Whether a successful run is worth a job_run row; failures are always recorded. */
  record?: (detail: string) => boolean | Promise<boolean>;
}

async function runJob(
  jobType: string,
  fn: () => Promise<string>,
  opts: RunOptions = {},
): Promise<JobOutcome> {
  try {
    const detail = await fn();
    if (!opts.record || (await opts.record(detail))) await recordRun(jobType, "succeeded", detail);
    return { jobType, status: "succeeded", detail };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await recordRun(jobType, "failed", undefined, error);
    return { jobType, status: "failed", error };
  }
}

/**
 * The admin console reads the sweep's rows as the scheduler heartbeat
 * (`schedulerEnabled`, which looks back `HEARTBEAT_WINDOW_MS`): an idle sweep
 * leaves one row per interval instead of 1,440 a day.
 */
export const SWEEP_HEARTBEAT_MS = 10 * 60_000;
export const HEARTBEAT_WINDOW_MS = 15 * 60_000;

/** Is the newest run of `jobType` older than `maxAgeMs`? (indexed: job_type, created_at) */
async function lastRunOlderThan(jobType: string, maxAgeMs: number): Promise<boolean> {
  const db = await getDb();
  const [last] = await db
    .select({ createdAt: jobRuns.createdAt })
    .from(jobRuns)
    .where(eq(jobRuns.jobType, jobType))
    .orderBy(desc(jobRuns.createdAt))
    .limit(1);
  return !last || Date.now() - new Date(last.createdAt).getTime() >= maxAgeMs;
}

/** Fixed frequent jobs — always run on tick. */
async function runFrequentJobs(): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];
  outcomes.push(
    await runJob("holds.sweep", () => executeJobBody("holds.sweep"), {
      record: async (detail) =>
        (JSON.parse(detail) as { cancelled: number }).cancelled > 0 ||
        (await lastRunOlderThan("holds.sweep", SWEEP_HEARTBEAT_MS)),
    }),
  );
  return outcomes;
}

/** A claimed job that has not finished is retried after this long (crash/failure retry). */
const JOB_LEASE_MS = 10 * 60_000;

/**
 * Compare-and-swap claim of one job slot: moves `next_run_at` from the value
 * we read to `to`. Exactly one concurrent tick wins (D1 serialises writes);
 * the rest see zero changed rows and skip the job.
 */
async function claimSlot(
  db: Awaited<ReturnType<typeof getDb>>,
  id: string,
  seen: string | null,
  to: Date,
): Promise<boolean> {
  const r = await db
    .update(scheduledJobs)
    .set({ nextRunAt: to.toISOString(), updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(scheduledJobs.id, id),
        seen === null ? isNull(scheduledJobs.nextRunAt) : eq(scheduledJobs.nextRunAt, seen),
      ),
    )
    .run();
  return r.meta.changes === 1;
}

/** Table-driven jobs: run when next_run_at is due, then advance it. */
async function runDueScheduledJobs(): Promise<JobOutcome[]> {
  const db = await getDb();
  const now = new Date();
  const offset = await tzOffset();
  const rows = await db.select().from(scheduledJobs).where(eq(scheduledJobs.enabled, true));
  const outcomes: JobOutcome[] = [];
  for (const job of rows) {
    // First tick after deployment: initialize next_run_at to the next slot.
    if (!job.nextRunAt) {
      await claimSlot(db, job.id, null, nextOccurrence(now, job.atHour, job.atMinute, offset));
      continue;
    }
    if (new Date(job.nextRunAt).getTime() > now.getTime()) continue;

    // Lease the slot first; on success move to the real next slot, on failure
    // the lease simply expires and the job is retried.
    const leased = await claimSlot(db, job.id, job.nextRunAt, new Date(Date.now() + JOB_LEASE_MS));
    if (!leased) continue;

    const outcome = await runJob(job.jobType, () => executeJobBody(job.jobType));
    if (outcome.status === "succeeded") {
      // Missed slots are skipped, not replayed (Rust `catch_up`).
      const next = catchUp(
        new Date(job.nextRunAt),
        Math.max(job.intervalDays, 1),
        Math.max(job.atHour, 0),
        Math.max(job.atMinute, 0),
        offset,
        new Date(),
      );
      await db
        .update(scheduledJobs)
        .set({ nextRunAt: next.toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(scheduledJobs.id, job.id));
    }
    outcomes.push(outcome);
  }
  return outcomes;
}

async function executeJobBody(jobType: string): Promise<string> {
  const db = await getDb();
  switch (jobType) {
    case "holds.sweep": {
      const r = await sweepExpiredHolds();
      return JSON.stringify({ cancelled: r.cancelled });
    }
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
            isNotNull(coupons.validUntil),
            lte(coupons.validUntil, nowIso),
          ),
        )
        .run();
      return JSON.stringify({ expired: r.meta.changes });
    }
    case "jobs.retention": {
      const r = await db.delete(jobRuns).where(lt(jobRuns.createdAt, retentionCutoff())).run();
      return JSON.stringify({ pruned: r.meta.changes });
    }
    case "trips.prune": {
      const today = new Date().toISOString().slice(0, 10);
      const r = await db
        .delete(seatInventory)
        .where(
          and(
            eq(seatInventory.status, "available"),
            inArray(
              seatInventory.tripSessionId,
              db
                .select({ id: tripSessions.id })
                .from(tripSessions)
                .where(lt(tripSessions.departureDate, today)),
            ),
          ),
        );
      return JSON.stringify({ pruned: r.meta.changes });
    }
    case "trips.warm": {
      const r = await warmTrips();
      return JSON.stringify(r);
    }
    default:
      throw new Error(`no job body for ${jobType}`);
  }
}

/** Run one job now and record the run. */
export const triggerJob = (jobType: string): Promise<JobOutcome> =>
  runJob(jobType, () => executeJobBody(jobType));

/** Cron entry point: POST /api/jobs/tick (service-token auth). */
export async function tick(): Promise<{ ran: JobOutcome[] }> {
  const frequent = await runFrequentJobs();
  const scheduled = await runDueScheduledJobs();
  // trips.warm every 6h: gate on the newest run. Ordered by created_at so the
  // (job_type, created_at) index answers it without scanning the table.
  if (await lastRunOlderThan("trips.warm", 6 * 3600_000)) {
    scheduled.push(await runJob("trips.warm", async () => JSON.stringify(await warmTrips())));
  }
  return { ran: [...frequent, ...scheduled] };
}

// ── Admin API (`/api/admin/cron-jobs`) ──────────────────────────

/** `CronJobRunOut`: `detail` is the stored JSON, parsed. */
export interface CronJobRunOut {
  id: string;
  jobType: string;
  status: string;
  detail?: unknown;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

function runOut(r: typeof jobRuns.$inferSelect): CronJobRunOut {
  let detail: unknown;
  try {
    detail = r.detail === null ? undefined : JSON.parse(r.detail);
  } catch {
    detail = undefined;
  }
  return {
    id: r.id,
    jobType: r.jobType,
    status: r.status,
    ...(detail !== undefined && { detail }),
    error: r.error,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    createdAt: r.createdAt,
  };
}

export async function latestRun(jobType: string): Promise<CronJobRunOut | null> {
  const db = await getDb();
  const row = (
    await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.jobType, jobType))
      .orderBy(desc(jobRuns.createdAt))
      .limit(1)
  )[0];
  return row ? runOut(row) : null;
}

function scheduleOut(s: typeof scheduledJobs.$inferSelect, lastRun: CronJobRunOut | null) {
  return {
    jobType: s.jobType,
    description: describe(s.jobType) ?? null,
    enabled: s.enabled,
    intervalDays: s.intervalDays,
    atHour: s.atHour,
    atMinute: s.atMinute,
    nextRunAt: s.nextRunAt,
    lastRun,
    updatedAt: s.updatedAt,
  };
}

/**
 * `GET /api/admin/cron-jobs`: the schedule rows, plus the two fixed-cadence
 * jobs that have no row. `schedulerEnabled` is the cron trigger's heartbeat:
 * `holds.sweep` ran within the last `HEARTBEAT_WINDOW_MS`.
 */
export async function listCronJobs() {
  const db = await getDb();
  const rows = await db.select().from(scheduledJobs).orderBy(asc(scheduledJobs.jobType));
  const runs = await Promise.all(
    [...rows.map((r) => r.jobType), "holds.sweep", "trips.warm"].map(
      async (t) => [t, await latestRun(t)] as const,
    ),
  );
  const last = new Map(runs);
  const fixed = ["holds.sweep", "trips.warm"].map((jobType) => ({
    jobType,
    description: describe(jobType) ?? null,
    enabled: true,
    intervalDays: 0,
    atHour: jobType === "trips.warm" ? 6 : 0,
    atMinute: 0,
    nextRunAt: null,
    lastRun: last.get(jobType) ?? null,
    updatedAt: new Date().toISOString(),
  }));
  const heartbeat = last.get("holds.sweep")?.createdAt;
  return {
    items: [...fixed, ...rows.map((r) => scheduleOut(r, last.get(r.jobType) ?? null))],
    schedulerEnabled:
      !!heartbeat && Date.now() - new Date(heartbeat).getTime() < HEARTBEAT_WINDOW_MS,
  };
}

/** `GET /api/admin/cron-jobs/runs`: newest first, 20 by default, at most 100. */
export async function listCronRuns(jobType: string | null, limit: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(jobRuns)
    .where(jobType ? eq(jobRuns.jobType, jobType) : undefined)
    .orderBy(desc(jobRuns.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return { items: rows.map(runOut) };
}

export interface UpdateCronJobBody {
  enabled?: boolean | null;
  intervalDays?: number | null;
  atHour?: number | null;
  atMinute?: number | null;
  resetNextRun?: boolean | null;
}

/** `UpdateCronJobRequest`'s `validator` ranges. */
export function validateUpdateCronJob(b: UpdateCronJobBody): void {
  if (typeof b !== "object" || b === null) throw badRequest("invalid request body");
  const inRange = (v: unknown, min: number, max: number) =>
    v == null || (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max);
  if (!inRange(b.intervalDays, 1, 365)) throw badRequest("interval days is outside 1..365");
  if (!inRange(b.atHour, 0, 23)) throw badRequest("at hour is outside 0..23");
  if (!inRange(b.atMinute, 0, 59)) throw badRequest("at minute is outside 0..59");
  for (const f of [b.enabled, b.resetNextRun])
    if (f != null && typeof f !== "boolean") throw badRequest("invalid request body");
}

/** `PATCH /api/admin/cron-jobs/{jobType}`: a new cadence (or `resetNextRun`) re-arms the next run from now. */
export async function updateCronJob(jobType: string, body: UpdateCronJobBody) {
  const db = await getDb();
  const model = (
    await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, jobType)).limit(1)
  )[0];
  if (!model) throw notFound(`no schedule for job "${jobType}"`);

  const cadenceChanged = body.intervalDays != null || body.atHour != null || body.atMinute != null;
  const atHour = body.atHour ?? model.atHour;
  const atMinute = body.atMinute ?? model.atMinute;
  const now = new Date().toISOString();
  await db
    .update(scheduledJobs)
    .set({
      enabled: body.enabled ?? model.enabled,
      intervalDays: body.intervalDays ?? model.intervalDays,
      atHour,
      atMinute,
      ...((body.resetNextRun === true || cadenceChanged) && {
        nextRunAt: nextOccurrence(
          new Date(),
          Math.max(atHour, 0),
          Math.max(atMinute, 0),
          await tzOffset(),
        ).toISOString(),
      }),
      updatedAt: now,
    })
    .where(eq(scheduledJobs.jobType, jobType));
  const updated = (
    await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, jobType)).limit(1)
  )[0]!;
  return scheduleOut(updated, await latestRun(jobType));
}

/**
 * `POST /api/admin/cron-jobs/{jobType}/trigger`. DELIBERATE: the run happens
 * inside the request (there is no background queue on Workers), so the
 * answer is the finished run, not a `queued` one.
 */
export async function triggerCronJob(jobType: string): Promise<CronJobRunOut> {
  if (!JOB_CATALOG.some((j) => j.kind === jobType)) throw notFound(`no job "${jobType}"`);
  const db = await getDb();
  const live = (
    await db
      .select({ id: jobRuns.id })
      .from(jobRuns)
      .where(and(eq(jobRuns.jobType, jobType), inArray(jobRuns.status, ["queued", "running"])))
      .limit(1)
  )[0];
  if (live)
    throw conflict(
      `${jobType} is already queued or running (run ${live.id}) — wait for it to finish`,
    );
  await triggerJob(jobType);
  return (await latestRun(jobType))!;
}

/** `POST /api/admin/cron-jobs/{jobType}/cancel`: only a run that is still queued or running can be cancelled. */
export async function cancelCronJob(jobType: string): Promise<CronJobRunOut> {
  const db = await getDb();
  const live = (
    await db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.jobType, jobType), inArray(jobRuns.status, ["queued", "running"])))
      .orderBy(desc(jobRuns.createdAt))
      .limit(1)
  )[0];
  if (!live) throw notFound(`${jobType} has no queued or running run`);
  await db
    .update(jobRuns)
    .set({ status: "cancelled", finishedAt: new Date().toISOString() })
    .where(eq(jobRuns.id, live.id));
  return (await latestRun(jobType))!;
}
