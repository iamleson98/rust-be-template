import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { deletePickupPoint, updatePickupPoint } from "@/lib/services/admin";

/** `PUT /api/admin/pickup-points/{id}` — update a pickup point; fields left out keep their values. */
export const PUT = staffRoute<IdParams>("admin:pickup_points:write", async (req, { params }) =>
  Response.json(await updatePickupPoint((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/pickup-points/{id}` — remove a pickup point. */
export const DELETE = staffRoute<IdParams>("admin:pickup_points:write", async (_req, { params }) =>
  Response.json(await deletePickupPoint((await params).id)),
);
