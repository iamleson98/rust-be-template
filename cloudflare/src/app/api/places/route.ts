import { popularPlacesCached } from "@/lib/services/lookups";
import { handleRouteError } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);
    const items = await popularPlacesCached(limit);
    return Response.json({ items });
  } catch (e) {
    return handleRouteError(e);
  }
}
