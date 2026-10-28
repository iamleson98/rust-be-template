import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { listCronJobs } from "@/lib/services/jobs";

/** `GET /api/admin/cron-jobs` — the schedule of every job with its latest run. */
export async function GET(req: Request) {
  try {
    await requirePermission(await requireStaff(req), "admin:cron-jobs:read");
    return Response.json(await listCronJobs());
  } catch (e) {
    return handleRouteError(e);
  }
}
