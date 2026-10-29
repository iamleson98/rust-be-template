import { handleRouteError } from "@/lib/api";
import { queryReader } from "@/lib/query";
import { placeCacheControl, popularPlaces } from "@/lib/services/place-search";

/**
 * `GET /api/places` — the most populous cities and towns (Rust: the `place`
 * table). `limit` defaults to 50, at most 200; `offset` skips the first rows.
 */
export async function GET(req: Request) {
  try {
    const q = queryReader(new URL(req.url).searchParams);
    const limit = Math.min(Math.max(q.u64("limit") ?? 50, 1), 200);
    const offset = q.u64("offset") ?? 0;
    const { items, engine } = await popularPlaces(limit, offset);
    return Response.json(
      { items },
      { headers: { "cache-control": placeCacheControl(engine, 3600) } },
    );
  } catch (e) {
    return handleRouteError(e);
  }
}
