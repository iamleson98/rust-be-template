import { err, readJson, staffRoute, type IdParams } from "@/lib/api";
import { adminBusLayoutDetail, deleteBusLayout, updateBusLayout } from "@/lib/services/admin";

/** `GET /api/admin/bus-layouts/{id}` — full layout incl. the floor plan. */
export const GET = staffRoute<IdParams>("admin:bus_layouts:read", async (_req, { params }) => {
  const detail = await adminBusLayoutDetail((await params).id);
  return detail ? Response.json(detail) : err(404, "not-found", "bus layout not found");
});

/** `PUT /api/admin/bus-layouts/{id}` — name, brand and vehicle type (the plan goes through `/plan`). */
export const PUT = staffRoute<IdParams>("admin:bus_layouts:write", async (req, { params }) =>
  Response.json(await updateBusLayout((await params).id, await readJson(req))),
);

/** `DELETE /api/admin/bus-layouts/{id}` — remove a layout (blocked while in use). */
export const DELETE = staffRoute<IdParams>("admin:bus_layouts:write", async (_req, { params }) =>
  Response.json(await deleteBusLayout((await params).id)),
);
