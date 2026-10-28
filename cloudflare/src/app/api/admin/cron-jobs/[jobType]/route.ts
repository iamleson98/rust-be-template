import { handleRouteError, readJson, requireStaff } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { updateCronJob, validateUpdateCronJob, type UpdateCronJobBody } from "@/lib/services/jobs";

/** `PATCH /api/admin/cron-jobs/{jobType}` — enable, disable or reschedule a job; a new cadence re-arms its next run. */
export async function PATCH(req: Request, ctx: { params: Promise<{ jobType: string }> }) {
  try {
    const staff = await requireStaff(req);
    const { jobType } = await ctx.params;
    const body = await readJson<UpdateCronJobBody>(req);
    validateUpdateCronJob(body);
    await requirePermission(staff, "admin:cron-jobs:write");
    return Response.json(await updateCronJob(jobType, body));
  } catch (e) {
    return handleRouteError(e);
  }
}
