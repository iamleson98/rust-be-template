import { readJson, staffRoute } from "@/lib/api";
import { adminAddressList, createAddress } from "@/lib/services/admin";

/**
 * `GET /api/admin/addresses?brandId=&q=&limit=&offset=` — a brand's
 * addresses, each with how many schedule stops use it (`stopCount`);
 * `q`/`limit`/`offset` feed the searchable, infinite-scroll schedule point
 * picker; omitting `limit` returns all.
 */
export const GET = staffRoute("admin:addresses:read", async (req) => {
  const q = new URL(req.url).searchParams;
  const limit = q.get("limit");
  return Response.json(
    await adminAddressList({
      brandId: q.get("brandId") ?? undefined,
      q: q.get("q")?.trim() || undefined,
      limit: limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500) : undefined,
      offset: Math.max(parseInt(q.get("offset") ?? "0", 10) || 0, 0),
    }),
  );
});

/** `POST /api/admin/addresses` — create an address in one of our cities. */
export const POST = staffRoute("admin:addresses:write", async (req) =>
  Response.json(await createAddress(await readJson(req)), { status: 201 }),
);
