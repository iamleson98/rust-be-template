import { readJson, staffRoute } from "@/lib/api";
import { pageOf } from "@/lib/query";
import { adminRouteList, createRoute } from "@/lib/services/admin";

/** `GET /api/admin/routes?brandId=&q=&limit=&offset=` — staff list (all statuses). */
export const GET = staffRoute("admin:routes:read", async (req) => {
  const q = new URL(req.url).searchParams;
  return Response.json(
    await adminRouteList({
      brandId: q.get("brandId") ?? undefined,
      q: q.get("q")?.trim() || undefined,
      ...pageOf(q, { limit: 100, max: 500 }),
    }),
  );
});

/** `POST /api/admin/routes` — create a route. */
export const POST = staffRoute("admin:routes:write", async (req) =>
  Response.json(await createRoute(await readJson(req)), { status: 201 }),
);
