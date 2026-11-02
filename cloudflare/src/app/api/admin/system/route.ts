import { adminRoute } from "@/lib/api";
import { systemReport } from "@/lib/services/system-status";

/**
 * `GET /api/admin/system` — what runs the site: the Worker, D1, the cron
 * driver and the VPS service (place search, OSM index, CPU/memory/disk).
 * Admin only; never cached.
 */
export const GET = adminRoute(async () => {
  return Response.json(await systemReport(), { headers: { "cache-control": "no-store" } });
});
