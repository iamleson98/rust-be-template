import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { triggerJobRunOut } from "@/lib/services/jobs";

type Params = { params: Promise<{ jobType: string }> };

/** `POST /api/admin/cron-jobs/{jobType}/trigger` — run a job now (Rust `CronJobRunOut`). */
export async function POST(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:write");
    const { jobType } = await ctx.params;
    const run = await triggerJobRunOut(jobType);
    return Response.json(run);
  } catch (e) {
    return handleRouteError(e);
  }
}
