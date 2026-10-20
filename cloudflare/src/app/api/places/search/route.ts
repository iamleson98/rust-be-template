import { popularPlaces, searchPlaces } from "@/lib/services/place-search";
import { handleRouteError } from "@/lib/api";

/** Results only change with a deploy (weekly index), so browsers may reuse them briefly. */
const CACHE = { "cache-control": "public, max-age=300" };

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10) || 10, 25);
    if (!q.trim()) {
      const items = await popularPlaces(limit);
      return Response.json({ items, engine: "static-shards" }, { headers: CACHE });
    }
    const items = await searchPlaces(q, limit);
    return Response.json({ items, engine: "static-shards" }, { headers: CACHE });
  } catch (e) {
    return handleRouteError(e);
  }
}
