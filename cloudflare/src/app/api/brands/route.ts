import { handleRouteError } from "@/lib/api";
import { publicJson } from "@/lib/public-cache";
import { queryReader } from "@/lib/query";
import { listBrands } from "@/lib/services/lookups";

/** `GET /api/brands` — active brands with their route counts; `limit` defaults to 20, at most 200. */
export async function GET(req: Request) {
  try {
    const limit = Math.min(queryReader(new URL(req.url).searchParams).u64("limit") ?? 20, 200);
    return publicJson(req, { items: await listBrands(limit) });
  } catch (e) {
    return handleRouteError(e);
  }
}
