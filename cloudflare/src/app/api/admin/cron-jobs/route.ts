import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { listJobsWithRuns } from "@/lib/services/jobs";

export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:read");
    const { jobs, recentRuns } = await listJobsWithRuns();
    return Response.json({
      items: jobs.map((j) => ({
        jobType: j.jobType,
        enabled: j.enabled,
        intervalDays: j.intervalDays,
        atHour: j.atHour,
        atMinute: j.atMinute,
        nextRunAt: j.nextRunAt,
      })),
      recentRuns,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
