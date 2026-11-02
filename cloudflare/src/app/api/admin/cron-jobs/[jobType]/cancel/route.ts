import { staffRoute } from "@/lib/api";
import { cancelCronJob } from "@/lib/services/jobs";

/** `POST /api/admin/cron-jobs/{jobType}/cancel` — cancel a queued or running run. */
export const POST = staffRoute<{ params: Promise<{ jobType: string }> }>(
  "admin:cron-jobs:write",
  async (req, ctx) => {
    return Response.json(await cancelCronJob((await ctx.params).jobType));
  },
);
