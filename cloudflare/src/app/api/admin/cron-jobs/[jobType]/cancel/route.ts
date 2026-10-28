import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { cancelCronJob } from "@/lib/services/jobs";

/** `POST /api/admin/cron-jobs/{jobType}/cancel` — cancel a queued or running run. */
export async function POST(req: Request, ctx: { params: Promise<{ jobType: string }> }) {
  try {
    await requirePermission(await requireStaff(req), "admin:cron-jobs:write");
    return Response.json(await cancelCronJob((await ctx.params).jobType));
  } catch (e) {
    return handleRouteError(e);
  }
}
