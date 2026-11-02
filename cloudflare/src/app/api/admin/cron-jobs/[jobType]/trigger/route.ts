import { staffRoute } from "@/lib/api";
import { triggerCronJob } from "@/lib/services/jobs";

/** `POST /api/admin/cron-jobs/{jobType}/trigger` — run a job now and answer the finished run. */
export const POST = staffRoute<{ params: Promise<{ jobType: string }> }>(
  "admin:cron-jobs:write",
  async (req, ctx) => {
    return Response.json(await triggerCronJob((await ctx.params).jobType));
  },
);
