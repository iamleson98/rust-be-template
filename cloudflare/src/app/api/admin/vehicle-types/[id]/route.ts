import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { deleteVehicleType, updateVehicleType } from "@/lib/services/admin";

/** `PUT /api/admin/vehicle-types/{id}` — update a vehicle type. */
export const PUT = staffRoute<IdParams>("admin:vehicle_types:write", async (req, { params }) =>
  Response.json(await updateVehicleType((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/vehicle-types/{id}` — remove a vehicle type. */
export const DELETE = staffRoute<IdParams>("admin:vehicle_types:write", async (_req, { params }) =>
  Response.json(await deleteVehicleType((await params).id)),
);
