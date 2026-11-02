import { staffRoute } from "@/lib/api";
import { intParam } from "@/lib/services/http-errors";
import { listCronRuns } from "@/lib/services/jobs";

/** `GET /api/admin/cron-jobs/runs?jobType=&limit=` — recent run history. */
export const GET = staffRoute("admin:cron-jobs:read", async (req) => {
  const q = new URL(req.url).searchParams;
  return Response.json(await listCronRuns(q.get("jobType"), intParam("limit", q.get("limit"), 20)));
});
