import { readJson, staffRoute } from "@/lib/api";
import { adminPickupPointList, createPickupPoint } from "@/lib/services/admin";

/** `GET /api/admin/pickup-points?routeId=` — a route's boarding points. */
export const GET = staffRoute("admin:pickup_points:read", async (req) =>
  Response.json(
    await adminPickupPointList(new URL(req.url).searchParams.get("routeId") ?? undefined),
  ),
);

/** `POST /api/admin/pickup-points` — create a pickup/dropoff point. */
export const POST = staffRoute("admin:pickup_points:write", async (req) =>
  Response.json(await createPickupPoint(await readJson(req)), { status: 201 }),
);
