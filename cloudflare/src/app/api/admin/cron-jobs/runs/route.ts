import { rawAll } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import type { CronJobRunOut } from "@/lib/services/jobs";

/** `GET /api/admin/cron-jobs/runs?jobType=&limit=` — recent run history. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:read");
    const url = new URL(req.url);
    const jobType = url.searchParams.get("jobType") ?? undefined;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
    const items = await rawAll<CronJobRunOut>(sql`
      SELECT id, job_type AS jobType, status, detail, error, started_at AS startedAt,
             finished_at AS finishedAt, created_at AS createdAt
      FROM job_run
      ${jobType ? sql`WHERE job_type = ${jobType}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}
