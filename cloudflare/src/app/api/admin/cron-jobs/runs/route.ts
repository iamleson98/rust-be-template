import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { intParam } from "@/lib/services/http-errors";
import { listCronRuns } from "@/lib/services/jobs";

/** `GET /api/admin/cron-jobs/runs?jobType=&limit=` — recent run history. */
export async function GET(req: Request) {
  try {
    await requirePermission(await requireStaff(req), "admin:cron-jobs:read");
    const q = new URL(req.url).searchParams;
    return Response.json(
      await listCronRuns(q.get("jobType"), intParam("limit", q.get("limit"), 20)),
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
