import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { queryReader, uuidParam } from "@/lib/query";
import { listRoutes } from "@/lib/services/lookups";

/**
 * `GET /api/routes` — active routes with their brand preview, endpoints,
 * schedule count and lowest base price. Query (Rust `RoutesQuery`):
 * `brand_id` (a UUID) and `limit` (default 50, clamped to 1..500).
 */
export async function GET(req: Request) {
  try {
    const q = queryReader(new URL(req.url).searchParams);
    const brandId = q.string("brand_id");
    const items = await listRoutes(
      brandId === undefined ? undefined : uuidParam(brandId, "brand_id"),
      q.u64("limit") ?? 50,
    );
    return publicJson(req, { items });
  } catch (e) {
    return handleRouteError(e);
  }
}
