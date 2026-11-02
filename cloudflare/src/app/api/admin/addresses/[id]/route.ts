import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { deleteAddress, updateAddress } from "@/lib/services/admin";

/** `PUT /api/admin/addresses/{id}` — update an address; fields left out keep their values. */
export const PUT = staffRoute<IdParams>("admin:addresses:write", async (req, { params }) =>
  Response.json(await updateAddress((await params).id, await readJson(req))),
);

/**
 * `DELETE /api/admin/addresses/{id}` — delete an address no schedule stops
 * at (deleting it would silently drop those stops).
 */
export const DELETE = staffRoute<IdParams>("admin:addresses:write", async (_req, { params }) =>
  Response.json(await deleteAddress((await params).id)),
);
