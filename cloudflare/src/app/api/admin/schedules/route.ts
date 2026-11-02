import { readJson, staffRoute } from "@/lib/api";
import { adminScheduleList, createSchedule } from "@/lib/services/admin";

/** `GET /api/admin/schedules?routeId=` — a route's schedules with fares + points. */
export const GET = staffRoute("admin:schedules:read", async (req) => {
  const url = new URL(req.url);
  const routeId = url.searchParams.get("routeId") ?? undefined;
  const items = await adminScheduleList(routeId);
  return Response.json({ items });
});

/** `POST /api/admin/schedules` — create a schedule with its points and fares (`services/admin-schedules.ts`). */
export const POST = staffRoute("admin:schedules:write", async (req) => {
  return Response.json(await createSchedule(await readJson(req)), { status: 201 });
});
