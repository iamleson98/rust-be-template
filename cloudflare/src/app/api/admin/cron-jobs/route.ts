import { getDb, rawAll } from "@/lib/db/client";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { jobRuns, scheduledJobs } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import type { CronJobRunOut } from "@/lib/services/jobs";

/**
 * `GET /api/admin/cron-jobs` — job registry with the latest run per job
 * (Rust `CronJobListResponse`). `schedulerEnabled` reports the cron
 * trigger heartbeat (a tick ran within 5 minutes).
 */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:read");
    const db = await getDb();
    const jobs = await db
      .select({
        id: scheduledJobs.id,
        jobType: scheduledJobs.jobType,
        enabled: scheduledJobs.enabled,
        intervalDays: scheduledJobs.intervalDays,
        atHour: scheduledJobs.atHour,
        atMinute: scheduledJobs.atMinute,
        nextRunAt: scheduledJobs.nextRunAt,
        updatedAt: scheduledJobs.updatedAt,
      })
      .from(scheduledJobs)
      .orderBy(asc(scheduledJobs.jobType));
    // The two fixed-cadence jobs (run on every tick) always exist in the registry.
    const fixed = [
      { jobType: "holds.sweep", enabled: 1, intervalDays: 0, atHour: 0, atMinute: 0 },
      { jobType: "trips.warm", enabled: 1, intervalDays: 0, atHour: 6, atMinute: 0 },
    ];
    const all = [
      ...fixed.map((f) => ({
        ...f,
        id: f.jobType,
        nextRunAt: null as string | null,
        updatedAt: new Date().toISOString(),
      })),
      ...jobs,
    ];
    // Latest run per job: a window function has no builder equivalent. (The
    // ids are random UUIDs, so MAX(id) would pick an arbitrary run.)
    const lastRuns = await rawAll<CronJobRunOut>(sql`
      SELECT id, jobType, status, detail, error, startedAt, finishedAt, createdAt FROM (
        SELECT id, job_type AS jobType, status, detail, error, started_at AS startedAt,
               finished_at AS finishedAt, created_at AS createdAt,
               ROW_NUMBER() OVER (PARTITION BY job_type ORDER BY created_at DESC, id) AS rn
        FROM job_run
      ) WHERE rn = 1
    `);
    const heartbeat = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.jobType, "holds.sweep"),
          gt(jobRuns.createdAt, new Date(Date.now() - 5 * 60_000).toISOString()),
        ),
      );
    return Response.json({
      items: all.map((j) => ({
        jobType: j.jobType,
        enabled: !!j.enabled,
        intervalDays: j.intervalDays,
        atHour: j.atHour,
        atMinute: j.atMinute,
        nextRunAt: j.nextRunAt,
        updatedAt: j.updatedAt,
        lastRun: lastRuns.find((r) => r.jobType === j.jobType) ?? null,
      })),
      schedulerEnabled: Number(heartbeat[0]?.n ?? 0) > 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
