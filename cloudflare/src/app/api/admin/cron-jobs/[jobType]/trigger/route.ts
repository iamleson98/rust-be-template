import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { triggerCronJob } from "@/lib/services/jobs";

/** `POST /api/admin/cron-jobs/{jobType}/trigger` — run a job now and answer the finished run. */
export async function POST(req: Request, ctx: { params: Promise<{ jobType: string }> }) {
  try {
    await requirePermission(await requireStaff(req), "admin:cron-jobs:write");
    return Response.json(await triggerCronJob((await ctx.params).jobType));
  } catch (e) {
    return handleRouteError(e);
  }
}
