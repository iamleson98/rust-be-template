import { staffRoute } from "@/lib/api";
import { presetCatalog } from "@/lib/services/admin";

/** `GET /api/admin/bus-layouts/presets` — the "create from template" catalog. */
export const GET = staffRoute("admin:bus_layouts:read", async () => {
  return Response.json({ items: presetCatalog() });
});
