import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
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
    const jobs = await rawAll<{
      id: string;
      job_type: string;
      enabled: number;
      interval_days: number;
      at_hour: number;
      at_minute: number;
      next_run_at: string | null;
      updated_at: string;
    }>(sql`
      SELECT id, job_type, enabled, interval_days, at_hour, at_minute, next_run_at, updated_at
      FROM scheduled_job ORDER BY job_type
    `);
    // The two fixed-cadence jobs (container driver) always exist in the registry.
    const fixed = [
      { job_type: "holds.sweep", enabled: 1, interval_days: 0, at_hour: 0, at_minute: 0 },
      { job_type: "trips.warm", enabled: 1, interval_days: 0, at_hour: 6, at_minute: 0 },
    ];
    const all = [
      ...fixed.map((f) => ({ ...f, id: f.job_type, next_run_at: null as string | null, updated_at: new Date().toISOString() })),
      ...jobs,
    ];
    const lastRuns = await rawAll<CronJobRunOut>(sql`
      SELECT id, job_type AS jobType, status, detail, error, started_at AS startedAt,
             finished_at AS finishedAt, created_at AS createdAt
      FROM job_run
      WHERE id IN (SELECT MAX(id) FROM job_run GROUP BY job_type)
    `);
    const heartbeat = await rawAll<{ n: number }>(sql`
      SELECT COUNT(*) AS n FROM job_run
      WHERE job_type = 'holds.sweep' AND created_at > datetime('now', '-5 minutes')
    `);
    return Response.json({
      items: all.map((j) => ({
        jobType: j.job_type,
        enabled: !!j.enabled,
        intervalDays: j.interval_days,
        atHour: j.at_hour,
        atMinute: j.at_minute,
        nextRunAt: j.next_run_at,
        updatedAt: j.updated_at,
        lastRun: lastRuns.find((r) => r.jobType === j.job_type) ?? null,
      })),
      schedulerEnabled: Number(heartbeat[0]?.n ?? 0) > 0,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
