import { handleRouteError } from "@/lib/api";
import { listBrands } from "@/lib/services/lookups";

/**
 * `GET /api/brands` — active brands (slim `BrandOut`: id, slug, name,
 * logoUrl, rating, routeCount). Rust default limit 20, clamp 1..500.
 * Cache-first: see `services/lookups.ts`.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      500,
    );
    const items = await listBrands(limit);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}
