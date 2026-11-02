import { readJson, staffRoute } from "@/lib/api";
import { pageOf } from "@/lib/query";
import { adminVehicleTypeList, createVehicleType } from "@/lib/services/admin";

/** `GET /api/admin/vehicle-types?q=&limit=&offset=` — staff catalog list. */
export const GET = staffRoute("admin:vehicle_types:read", async (req) => {
  const q = new URL(req.url).searchParams;
  return Response.json(
    await adminVehicleTypeList({
      q: q.get("q")?.trim() || undefined,
      ...pageOf(q, { limit: 100, max: 500 }),
    }),
  );
});

/** `POST /api/admin/vehicle-types` — create a vehicle type. */
export const POST = staffRoute("admin:vehicle_types:write", async (req) =>
  Response.json(await createVehicleType(await readJson(req)), { status: 201 }),
);
