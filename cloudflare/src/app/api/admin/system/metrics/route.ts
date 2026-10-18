import { handleRouteError, requireStaff } from "@/lib/api";
import { isAdmin } from "@/lib/auth/rbac";

/** `GET /api/admin/system/metrics` — Workers-flavoured metrics snapshot. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    if (!isAdmin(staff))
      return Response.json(
        { error: { code: "forbidden", message: "Admin access required" } },
        { status: 403 },
      );
    const now = new Date().toISOString();
    return Response.json({
      hostname: "cloudflare-workers",
      osName: "workerd",
      kernelVersion: "v8-isolate",
      timestamp: now,
      uptimeSecs: Math.floor(performance.now() / 1000),
      logicalCores: 0,
      physicalCores: 0,
      memoryTotalBytes: 134217728,
      memoryUsedBytes: 0,
      memoryAvailableBytes: 134217728,
      memoryUsagePercent: 0,
      processMemoryBytes: 0,
      processCpuUsagePercent: 0,
      cpuUsagePercent: 0,
      perCoreUsagePercent: [],
      disks: [],
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
