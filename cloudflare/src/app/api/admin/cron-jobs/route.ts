import { getDb, rawAll } from "@/lib/db/client";
import { asc, eq, sql } from "drizzle-orm";
import { jobRuns, scheduledJobs } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import type { CronJobRunOut } from "@/lib/services/jobs";

/**
 * `GET /api/admin/cron-jobs` — job registry with the latest run per job
 * (Rust `CronJobListResponse`). `schedulerEnabled` reports the container
 * cron driver heartbeat (last tick within 5 minutes).
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
    // The two fixed-cadence jobs (container driver) always exist in the registry.
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
    // Latest run per job: MAX(id) per group is a grouping trick with no
    // builder equivalent — one parameterized statement, no user input.
    const lastRuns = await rawAll<CronJobRunOut>(sql`
      SELECT id, job_type AS jobType, status, detail, error, started_at AS startedAt,
             finished_at AS finishedAt, created_at AS createdAt
      FROM job_run
      WHERE id IN (SELECT MAX(id) FROM job_run GROUP BY job_type)
    `);
    const heartbeat = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobRuns)
      .where(
        sql`${jobRuns.jobType} = 'holds.sweep' AND ${jobRuns.createdAt} > datetime('now', '-5 minutes')`,
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
