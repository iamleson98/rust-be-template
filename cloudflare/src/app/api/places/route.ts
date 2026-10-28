import { handleRouteError } from "@/lib/api";
import { queryReader } from "@/lib/query";
import { popularPlaces } from "@/lib/services/place-search";

/** The popular-places list changes only with a deploy (weekly index). */
const CACHE = { "cache-control": "public, max-age=3600" };

/**
 * `GET /api/places` — the most populous places (Rust: the `place` table; the
 * port reads the shipped index, whose `popular.json` is ordered the same
 * way). `limit` defaults to 50, at most 200; `offset` skips the first rows.
 */
export async function GET(req: Request) {
  try {
    const q = queryReader(new URL(req.url).searchParams);
    const limit = Math.min(Math.max(q.u64("limit") ?? 50, 1), 200);
    const offset = q.u64("offset") ?? 0;
    const items = (await popularPlaces(offset + limit)).slice(offset);
    return Response.json({ items }, { headers: CACHE });
  } catch (e) {
    return handleRouteError(e);
  }
}
