import { getDb } from "@/lib/db/client";
import { desc, eq } from "drizzle-orm";
import { jobRuns } from "@/lib/db/schema";
import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";

/** `GET /api/admin/cron-jobs/runs?jobType=&limit=` — recent run history. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:read");
    const url = new URL(req.url);
    const jobType = url.searchParams.get("jobType") ?? undefined;
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
      200,
    );
    const db = await getDb();
    const items = await db
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
      .where(jobType ? eq(jobRuns.jobType, jobType) : undefined)
      .orderBy(desc(jobRuns.createdAt))
      .limit(limit);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}
