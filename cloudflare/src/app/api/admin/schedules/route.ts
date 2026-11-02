import { handleRouteError, requireStaff, readJson } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { adminScheduleList } from "@/lib/services/admin-out";
import { createSchedule } from "@/lib/services/admin-schedules";

/** `GET /api/admin/schedules?routeId=` — a route's schedules with fares + points. */
export async function GET(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:read");
    const url = new URL(req.url);
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const items = await adminScheduleList(routeId);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** `POST /api/admin/schedules` — create a schedule with its points and fares (`services/admin-schedules.ts`). */
export async function POST(req: Request) {
  try {
    const staff = await requireStaff(req);
    await requirePermission(staff, "admin:schedules:write");
    return Response.json(await createSchedule(await readJson(req)), { status: 201 });
  } catch (e) {
    return handleRouteError(e);
  }
}
