import { handleRouteError, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { triggerJob } from "@/lib/services/jobs";

export async function POST(req: Request, ctx: { params: Promise<{ jobType: string }> }) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:cron-jobs:write");
    const { jobType } = await ctx.params;
    const outcome = await triggerJob(jobType);
    return Response.json(outcome);
  } catch (e) {
    return handleRouteError(e);
  }
}
