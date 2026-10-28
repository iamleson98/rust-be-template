import { getDb } from "@/lib/db/client";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { jobRuns, scheduledJobs } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { HEARTBEAT_WINDOW_MS, latestRun } from "@/lib/services/jobs";

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
    // Latest run per job, one indexed lookup each (job_type, created_at): a
    // window function over job_run would read every row on each page view.
    const lastRuns = await Promise.all(all.map((j) => latestRun(j.jobType)));
    const heartbeat = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.jobType, "holds.sweep"),
          gt(jobRuns.createdAt, new Date(Date.now() - HEARTBEAT_WINDOW_MS).toISOString()),
        ),
      );
    return Response.json({
      items: all.map((j, i) => ({
        jobType: j.jobType,
        enabled: !!j.enabled,
        intervalDays: j.intervalDays,
        atHour: j.atHour,
        atMinute: j.atMinute,
        nextRunAt: j.nextRunAt,
        updatedAt: j.updatedAt,
        lastRun: lastRuns[i] ?? null,
      })),
      schedulerEnabled: Number(heartbeat[0]?.n ?? 0) > 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
