import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { deleteSchedule, updateSchedule } from "@/lib/services/admin";

/** `PUT /api/admin/schedules/{id}` — update a schedule; `points` / `classFares` replace when present. */
export const PUT = staffRoute<IdParams>("admin:schedules:write", async (req, { params }) =>
  Response.json(await updateSchedule((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/schedules/{id}` — remove a schedule (cascades points/fares). */
export const DELETE = staffRoute<IdParams>("admin:schedules:write", async (_req, { params }) =>
  Response.json(await deleteSchedule((await params).id)),
);
