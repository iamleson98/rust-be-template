import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { cancelRun } from "@/lib/services/jobs";

type Params = { params: Promise<{ jobType: string }> };

/** `POST /api/admin/cron-jobs/{jobType}/cancel` — mark an in-flight run cancelled. */
export async function POST(req: Request, ctx: Params) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:write");
    const { jobType } = await ctx.params;
    const run = await cancelRun(jobType);
    return Response.json(run);
  } catch (e) {
    return handleRouteError(e);
  }
}
