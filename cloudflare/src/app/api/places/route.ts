import { popularPlaces } from "@/lib/services/place-search";
import { handleRouteError } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);
    const items = await popularPlaces(limit);
    return Response.json({ items }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (e) {
    return handleRouteError(e);
  }
}
