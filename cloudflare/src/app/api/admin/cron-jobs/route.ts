import { staffRoute } from "@/lib/api";
import { listCronJobs } from "@/lib/services/jobs";

/** `GET /api/admin/cron-jobs` — the schedule of every job with its latest run. */
export const GET = staffRoute("admin:cron-jobs:read", async () => {
  return Response.json(await listCronJobs());
});
