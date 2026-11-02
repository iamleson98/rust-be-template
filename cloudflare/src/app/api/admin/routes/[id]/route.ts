import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { deleteRoute, updateRoute } from "@/lib/services/admin";

/** `PUT /api/admin/routes/{id}` — update a route; fields left out keep their values. */
export const PUT = staffRoute<IdParams>("admin:routes:write", async (req, { params }) =>
  Response.json(await updateRoute((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/routes/{id}` — remove a route (cascades schedules/pickup points). */
export const DELETE = staffRoute<IdParams>("admin:routes:write", async (_req, { params }) =>
  Response.json(await deleteRoute((await params).id)),
);
