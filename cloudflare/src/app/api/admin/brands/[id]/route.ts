import { readJson, staffRoute, type IdParams } from "@/lib/api";
import { deactivateBrand, updateBrand } from "@/lib/services/admin";

/** `PUT /api/admin/brands/{id}` — update a brand; fields left out keep their values. */
export const PUT = staffRoute<IdParams>("admin:brands:write", async (req, { params }) =>
  Response.json(await updateBrand((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/brands/{id}` — deactivate the brand (routes and bookings still point at it). */
export const DELETE = staffRoute<IdParams>("admin:brands:write", async (_req, { params }) =>
  Response.json(await deactivateBrand((await params).id)),
);
