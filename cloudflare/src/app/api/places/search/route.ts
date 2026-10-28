import { handleRouteError } from "@/lib/api";
import { queryReader } from "@/lib/query";
import { popularPlaces, searchPlaces } from "@/lib/services/place-search";

/** Results only change with a deploy (weekly index), so browsers may reuse them briefly. */
const CACHE = { "cache-control": "public, max-age=300" };

/**
 * `GET /api/places/search?q=&limit=` — place autocomplete. `limit` defaults
 * to 10, at most 50. A blank `q` lists the popular places (Rust answered
 * with nothing; the autocomplete shows them before the first keystroke).
 */
export async function GET(req: Request) {
  try {
    const q = queryReader(new URL(req.url).searchParams);
    const text = q.required.string("q");
    const limit = Math.min(Math.max(q.u64("limit") ?? 10, 1), 50);
    const items = text.trim() ? await searchPlaces(text, limit) : await popularPlaces(limit);
    return Response.json({ items, engine: "static-shards" }, { headers: CACHE });
  } catch (e) {
    return handleRouteError(e);
  }
}
