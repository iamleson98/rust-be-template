import { readJson, staffRoute } from "@/lib/api";
import { pageOf } from "@/lib/query";
import { adminBusLayoutList, createBusLayout } from "@/lib/services/admin";

/**
 * `GET /api/admin/bus-layouts?brandId=&includeShared=&limit=&offset=` —
 * staff list (slim); `includeShared=true` adds the shared catalog (no brand)
 * to a brand's own layouts, as the schedule form offers both.
 */
export const GET = staffRoute("admin:bus_layouts:read", async (req) => {
  const q = new URL(req.url).searchParams;
  return Response.json(
    await adminBusLayoutList({
      brandId: q.get("brandId") ?? undefined,
      includeShared: q.get("includeShared") === "true",
      ...pageOf(q, { limit: 100, max: 500 }),
    }),
  );
});

/** `POST /api/admin/bus-layouts` — create a layout from a plan (or a seat grid). */
export const POST = staffRoute("admin:bus_layouts:write", async (req) =>
  Response.json(await createBusLayout(await readJson(req)), { status: 201 }),
);
