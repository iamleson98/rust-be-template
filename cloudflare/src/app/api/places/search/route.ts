import { popularPlaces, searchPlaces } from "@/lib/services/place-search";
import { handleRouteError } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") ?? "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "10", 10) || 10, 25);
    if (!q.trim()) {
      const items = await popularPlaces(limit);
      return Response.json({ items, engine: "d1-fts5" });
    }
    const items = await searchPlaces(q, limit);
    return Response.json({ items, engine: "d1-fts5" });
  } catch (e) {
    return handleRouteError(e);
  }
}
