import { getEnv } from "@/lib/db/client";
import { handleRouteError, err } from "@/lib/api";
import { tick } from "@/lib/services/jobs";

/**
 * POST /api/jobs/tick — cron entry point driven by the container scheduler.
 * Auth: X-Cron-Token header matching CRON_SERVICE_TOKEN (service-to-service).
 */
export async function POST(req: Request) {
  try {
    const env = await getEnv();
    const expected = env.CRON_SERVICE_TOKEN;
    const provided = req.headers.get("x-cron-token");
    if (!expected || provided !== expected) {
      return err(401, "unauthorized", "Invalid cron service token");
    }
    const result = await tick();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return handleRouteError(e);
  }
}
