import { getDb } from "@/lib/db/client";
import { jobRuns, scheduledJobs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

type Params = { params: Promise<{ jobType: string }> };

interface UpdateBody {
  enabled?: boolean | null;
  intervalDays?: number | null;
  atHour?: number | null;
  atMinute?: number | null;
  resetNextRun?: boolean | null;
}

/**
 * `PATCH /api/admin/cron-jobs/{jobType}` — enable/disable, reschedule or
 * reset the next-run pointer of a table-driven job (Rust `CronJobOut`).
 */
export async function PATCH(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:write");
    const { jobType } = await ctx.params;
    const body = await readJson<UpdateBody>(req);
    const db = await getDb();

    // Upsert the registry row: fixed-cadence jobs get a row too (enabled
    // only affects the table-driven sweep in the tick executor).
    const existing = (
      await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, jobType)).limit(1)
    )[0];
    if (!existing) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(scheduledJobs).values({
        id,
        jobType,
        enabled: body.enabled ?? true,
        intervalDays: body.intervalDays ?? 1,
        atHour: body.atHour ?? 0,
        atMinute: body.atMinute ?? 0,
        nextRunAt: body.resetNextRun ? now : null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      const nextRun =
        body.resetNextRun === true
          ? new Date().toISOString()
          : body.enabled === false
            ? null
            : existing.nextRunAt;
      await db
        .update(scheduledJobs)
        .set({
          enabled: body.enabled ?? existing.enabled,
          intervalDays: body.intervalDays ?? existing.intervalDays,
          atHour: body.atHour ?? existing.atHour,
          atMinute: body.atMinute ?? existing.atMinute,
          nextRunAt: nextRun,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(scheduledJobs.jobType, jobType));
    }

    const row = (
      await db.select().from(scheduledJobs).where(eq(scheduledJobs.jobType, jobType)).limit(1)
    )[0]!;
    const lastRun = (
      await db
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
        .limit(1)
    )[0];

    return Response.json({
      jobType: row.jobType,
      enabled: row.enabled,
      intervalDays: row.intervalDays,
      atHour: row.atHour,
      atMinute: row.atMinute,
      nextRunAt: row.nextRunAt,
      updatedAt: row.updatedAt,
      lastRun: lastRun ?? null,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
